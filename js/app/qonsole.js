var qonsole = function() {
  "use strict";

  /** The loaded configuration */
  var _config = {};
  var _defaults = {};
  var _current_query = null;
  var _query_editor = null;

  /** User has selected a different layout of the main query area */
  var onSelectLayout = function( e ) {
    e.preventDefault();
    if ($(e.target).attr("data-layout") === "vertical") {
      $("#query-block").removeClass("span6").addClass("span12");
      $("#results-block").removeClass("span6").addClass("row-fluid");
      $("#results-block > div").addClass( "span12" );
    }
    else {
      $("#query-block").removeClass("span12").addClass("span6");
      $("#results-block").removeClass("row-fluid").addClass("span6");
      $("#results-block > div").removeClass( "span12" );
    }
  };

  /** Failed to load the configuration */
  var onConfigFail = function() {
    alert("Failed to load qonfig.json");
  };

  var showQueries = function( config ) {
    $.each( _config, function( i, c ) {
      var html = sprintf( "<label class='radio'><input type='radio' value='%s' name='query' title='%s' data-query-id='%s'/>%s</label>",
                          c.name, c.desc, i, c.summary );
      $("#queries").append( html );
    } );

    selectQuery( $("#queries").find( "input" )[0] );
  };

  var selectQuery = function( elt ) {
    var queryId = $(elt).attr( "data-query-id" ) || $(elt).find("[data-query-id]").first().attr( "data-query-id");
    _current_query = _config[queryId];

    $($("#queries").find( "input" )[queryId]).attr( "checked", true );
    loadPrefixes( queryId );
    loadQuery( queryId );
    clearResults();
  };

  var loadPrefixes = function( queryId ) {
    $("#prefixes").empty();
    if (_defaults && _defaults.prefixes) {
      $.each( _defaults.prefixes, function( k, v ) {loadPrefix( k, v )} );
    }
    if (currentQueryConfig() && currentQueryConfig().prefixes) {
      $.each( currentQueryConfig().prefixes, function( k, v ) {loadPrefix( k, v )} );
    }
  };

  var loadPrefix = function( prefix, uri ) {
    var html = sprintf( "<li><label><input type='checkbox' checked='true' value='%s'></input> %s:</label></li>", uri, prefix );
    $("#prefixes").append( html );
  }

  var addOrRemovePrefix = function( e ) {
    var elt = $(e.target);
    var prefix = $.trim(elt.parent().text()).replace( /:/, "" );
    var uri = elt.attr("value");

    addPrefixDeclaration( prefix, uri, elt.is( ":checked" ) );
  };

  var addPrefixDeclaration = function( pref, uri, add ) {
    var query = currentQueryText();
    var lines = query.split( "\n" );
    var pattern = new RegExp( "^prefix +" + pref + ":");
    var found = false;

    for (var i = 0; !found && i < lines.length; i++) {
      found = lines[i].match( pattern );
      if (found && !add) {
        lines.splice( i, 1 );
      }
    }

    if (!found && add) {
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].match( /^prefix/ )) {
          lines.splice( i, 0, sprintf( "prefix %s: <%s>", pref, uri ) );
          break;
        }
      }
    }

    setCurrentQueryText( lines.join( "\n" ) );
  };

  var endpointURL = function() {
    var ep = null;
    if (currentQueryConfig()) {
      ep = currentQueryConfig().endpoint;
    }

    ep = ep || (_defaults && _defaults.endpoint);
    ep = ep || "/sparql";

    return ep;
  };

  var runQuery = function( e ) {
    e.preventDefault();
    hideTimeTaken();

    var url = $("#query-chrome2 input").val();
    var query = currentQueryText();
    var format = selectedFormat();
    var now = new Date();

    var options = {
      data: {query: query, output: format},
      success: function( data ) {onQuerySuccess( data, now );},
      error: function( x, t, e ) {onQueryFail( x, t, e, now );}
    };

    // hack TODO remove
    if (selectedFormat() === "xml" || selectedFormat() === "json"){
      options.data["force-accept"] = "text/plain";
    }

    // IE doesn't speak CORS
    if (isIE()) {
      // options.dataType = "jsonp";
    }

    $.ajax( url, options );
  };

  var selectedFormat = function() {
    return $("#format-choice button.active" ).attr( "data-format" );
  };

  var onQueryFail = function( jqXHR, textStatus, errorThrown, then ) {
    showPlainTextResult( jqXHR.responseText || jqXHR.statusText, then, 0, "errorText", null );
  };

  var onQuerySuccess = function( data, then ) {
    switch (selectedFormat()) {
      case "text":
        showPlainTextResult( data, then, null, null, "errorText" );
        break;
      case "json":
        showPlainTextResult( data, then, "errorText" );
        break;
      case "xml":
        showPlainTextResult( data, then, "errorText" );
        break;
      case "tsv":
        showTableResult( data, then );
        break;
    }
  };

  var clearResults = function() {
    $("#results").empty();
    $("#loadingSpinner").hide();
    $("#timeTaken").addClass( "hidden" );
  };

  var showPlainTextResult = function( data, then, count, addClass, removeClass ) {
    var lineLength = 100;
    var lineLength = 0;
    var lineCount = 0;
    var counting = true;
    var k = 0;

    while (counting) {
      var nextNewline = data.indexOf( "\n", k );
      if (nextNewline < 0) {
        counting = false;
      }
      else {
        lineCount++;

        if ((nextNewline - k) > lineLength) {
          lineLength = nextNewline - k;
        }

        k = nextNewline + 1;
      }
    }

    // we ignore 4 rows of chrome in the query format
    showTimeTaken( (count === null) ? lineCount - 4 : count, then );


    // versions of IE break the text formatting of pre nodes. Why? FFS
    if (isIE()) {
      $("#results").html( "<div></div>" );
      var n = $("#results").children().get( 0 );
      n.outerHTML = sprintf( "<pre class='span12 results-plain' style='min-width: %dpx'>", lineLength * 8 ) + data.replace( /</g, "&lt;" ) + "</pre>";
    }
    else {
      $( "#results" ).html( sprintf( "<pre class='span12 results-plain' style='min-width: %dpx'></pre>", lineLength * 8 ));
      $( "#results pre.results-plain" ).text( data );
    }
    $( "#results pre.results-plain" ).addClass( addClass )
                                     .removeClass( removeClass );
  };

  var showTableResult = function( data, then ) {
    var lines = data.split( "\n" );
    var lineCount = 0;

    var data = new google.visualization.DataTable();
    $.each( lines.shift().split("\t"), function(i, c ) {data.addColumn('string', c);} );

    $.each( lines, function( i, l ) {
      if (l && l !== "") {
        lineCount++;
        var d = [];
        $.each( l.split( "\t" ), function( i, v ) {d.push( /*v.slice( 1, -1 )*/ v );} ); // TODO format values properly
        data.addRows( [d] );
      }
    } );

    showTimeTaken( lineCount, then );
    $("#results").empty();
    var table = new google.visualization.Table(document.getElementById('results'));
    table.draw(data, {
      showRowNumber: true,
      page: "enable",
      pageSize: 25,
      alternatingRowStyle: true
    });

  };

  var hideTimeTaken = function() {
    $("#timeTaken").addClass( "hidden" );
  };

  var showTimeTaken = function( count, then ) {
    var duration = new Date().getTime() - then.getTime();
    var ms = duration % 1000;
    duration = Math.floor( duration / 1000 );
    var s = duration % 60;
    var m = Math.floor( duration / 60 );

    var html = (count === 1) ? "1 row in: " : (count + " rows in: ");
    $("#timeTaken").html( html + m + "min " + s + "s " + ms + "ms." );
    $("#timeTaken").removeClass("hidden");
  };

  var isOpera = function() {return !!(window.opera && window.opera.version);};  // Opera 8.0+
  var isFirefox = function() {return testCSS('MozBoxSizing');};                 // FF 0.8+
  var isSafari = function() {return Object.prototype.toString.call(window.HTMLElement).indexOf('Constructor') > 0;};    // At least Safari 3+: "[object HTMLElementConstructor]"
  var isChrome = function() {return !isSafari() && testCSS('WebkitTransform');};  // Chrome 1+
  var isIE = function() {return /*@cc_on!@*/false || testCSS('msTransform');};  // At least IE6

  var testCSS =  function(prop) {
      return prop in document.documentElement.style;
  }

  /* ---- new ---- */

  /** Initialisation - only called once */
  var init = function( config ) {
    // $(".sidebar-nav .btn-group").each( function(i,b) {$(b).button();} );
    // $("#layout-options .btn").click( onSelectLayout );
    // $("#queries").click( "input", function( e ) {selectQuery( e.target );} );
    // $("#prefixes").click( "input", addOrRemovePrefix );
    // $("#query-chrome2 a").click( runQuery );

    $('#loadingSpinner')
      .hide()
      .ajaxStart(function() {$(this).show();})
      .ajaxStop(function() {$(this).hide();});

    loadConfig( config );
  };

  /** Load the configuration definition */
  var loadConfig = function( config ) {
    if (config.configURL) {
      $.getJSON( config.configURL, onConfigLoaded )
       .error( onConfigFail );
    }
    else {
      onConfigLoaded( config )
    }
  };

  /** Successfully loaded the configuration */
  var onConfigLoaded = function( config, status, jqXHR ) {
    _config = config;
    initPrefixes( config );
    initExamples( config );
    initEndpoints( config );
    initQuery( config );
  };

  /** Return the configuration of the currently selected example query */
  var currentQueryConfig = function() {
    return _current_query;
  };

  /** List the current defined prefixes from the config */
  var initPrefixes = function( config ) {
    var prefixAdd = $("ul.prefixes li:last" );
    $.each( config.prefixes, function( key, value ) {
      var html = sprintf( "<li><a class='btn btn-info btn-sm active' data-toggle='button' data-uri='%s'>%s</a></li>", value, key );
      $(html).insertBefore( prefixAdd);
    } );
  };

  /** List the example queries from the config */
  var initExamples = function( config ) {
    var examples = $("ul.examples");
    examples.empty();

    $.each( config.queries, function( i, queryDesc ) {
      var html = sprintf( "<li><a class='btn btn-info btn-sm' data-toggle='button' data-query='%s'>%s</a></li>",
                          queryDesc.query, queryDesc.name );
      examples.append( html );
    } );

    examples.find("a").first().addClass( "active" );
  };

  /** Set up the drop-down list of end-points */
  var initEndpoints = function( config ) {
    var endpoints = $("ul.endpoints");
    endpoints.empty();

    $.each( config.endpoints, function( key, url ) {
      var html = sprintf( "<li role='presentation'><a role='menuitem' tabindex='-1' href='#'>%s</a></li>",
                          url );
      endpoints.append( html );
    } );

    $("[id=sparqlEndpoint]").val( config.endpoints["default"] );
  };

  /** Set the initial query, which will be the default selection plus the selected prefixes */
  var initQuery = function( config ) {
    showCurrentQuery();
  };

  /** Return the DOM node representing the query editor */
  var queryEditor = function() {
    if (!_query_editor) {
      _query_editor = CodeMirror( $("#query-edit-cm").get(0), {
        lineNumbers: true,
        mode: "sparql"
      } );
    }
    return _query_editor;
  };

  /** Return the current value of the query edit area */
  var currentQueryText = function() {
    return queryEditor().getValue();
  };

  /** Set the value of the query edit area */
  var setCurrentQueryText = function( text ) {
    queryEditor().setValue( text );
  };

  /** Display the given query, with the currently defined prefixes */
  var showCurrentQuery = function() {
    var query = currentQuery().data( "query" );
    var q = sprintf( "%s\n\n%s", renderCurrentPrefixes(), query );
    setCurrentQueryText( q );
  };

  /** Return the currently selected example query */
  var currentQuery = function() {
    return $("ul.examples a.active").first();
  };

  /** Return a string comprising the currently selected prefixes */
  var renderCurrentPrefixes = function() {
    var l = $("ul.prefixes a.active" ).map( function( i, elt ) {
      return sprintf( "prefix %s: <%s>", $(elt).text().trim(), $(elt).data( "uri" ) );
    } );
    return $.makeArray(l).join( "\n" );
  };



  return {
    init: init
  }
}();

