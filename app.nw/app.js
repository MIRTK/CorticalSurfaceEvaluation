var path = require('path');
var sql = require('sqlite3');

var startPage = "open";
var contactName = "Andreas Schuh";
var contactMailTo = "mailto:andreas.schuh@imperial.ac.uk?subject=Neonatal cortex evaluation"

global.neitherMeshId = 1;
global.initialMeshId = 3;
global.whiteMeshId = 4;
global.v2mMeshId = 5;

global.db = null;
global.dbPrev = null;
global.dbFile = null;
global.imgBase = null;
global.evalSetId = 0;
global.raterId = 0;
global.overlayId = 0;

global.compSetId = 0;
global.compTableName = '';

// When the comparison set contains just screenshots where only two colors
// are used for the two overlaid surface contours, these two colors are used
// for the two buttons of the respective choice. The buttons then never change
// color to not confuse the rater with two many color changes. Otherwise,
// this list is empty and the colors of the buttons is set each time to
// the color of the respective contour, instead.
global.compColors = [];

// The following array is initialized by initCompPage and either randomly
// shuffled in place by updateCompPage when multiple colors per overlay
// are being used, or re-ordered according to the current 2-color assingment
// of the two overlays. It is used to assign an overlay to one of the
// two choices, '#choice-0' and '#choice-1' (excl. "Neither").
global.compOverlayIds = [];


// ----------------------------------------------------------------------------
// Common auxiliary functions

function rgbValueToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
    return "#" + rgbValueToHex(r) + rgbValueToHex(g) + rgbValueToHex(b);
}

function colorToHex(color) {
  if (color.search("rgb") == -1) {
    return color;
  } else {
    var rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    var r = parseInt(rgb[1]);
    var g = parseInt(rgb[2]);
    var b = parseInt(rgb[3]);
    return rgbToHex(r, g, b);
  }
}

/**
 * Randomize array element order in-place.
 * Using Durstenfeld shuffle algorithm.
 *
 * http://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
 */
function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

var entityMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': '&quot;',
  "'": '&#39;',
  "/": '&#x2F;'
};

function escapeHtml(string) {
  return String(string).replace(/[&<>"'\/]/g, function (s) {
    return entityMap[s];
  });
}

function sqlValueInSet(column, cond, values) {
  var code = undefined;
  if (values instanceof Array) {
    if (values.length === 1 && cond == "NOT IN") {
      code = column + " <> " + values[0];
    } else if (values.length === 1 && cond == "IN") {
      code = column + " = " + values[0];
    } else {
      code = column + " " + cond + " (";
      for (var i = 0; i < values.length; i++) {
        if (i > 0) code += ", ";
        code += values[i];
      }
      code += ")";
    }
  } else {
    if (cond == "NOT IN") {
      code = column + " <> " + values;
    } else if (cond == "IN") {
      code = column + " = " + values;
    } else {
      code = column + " " + cond + " (" + values + ")";
    }
  }
  return code;
}

function showError(html) {
  var template = document.querySelector('#errorTemplate').content;
  var clone = document.importNode(template, true);
  var message = clone.getElementById('msg');
  message.innerHTML = html;
  document.getElementById('alerts').appendChild(clone);
}

function showErrorMessage(msg) {
  showError(escapeHtml(msg));
}

function showSqlError(msg, err) {
  showError(msg + ": " + escapeHtml(err));
}

function showSuccess(html) {
  var template = document.querySelector('#successTemplate').content;
  var alert = template.getElementById('msg');
  alert.innerHTML = html;
  var clone = document.importNode(template, true);
  document.getElementById('alerts').appendChild(clone);
}

function showSuccessMessage(msg) {
  showSuccess(escapeHtml(msg));
}

function clearErrors() {
  $("#alerts").empty();
}

function changeNavLink(name) {
  $(".navbar>.nav>.nav-link.active").removeClass("active");
  var link = $(".navbar #nav-" + name);
  if (link.length === 1) link.addClass("active");
}

function changeTemplate(name) {
  clearErrors();
  var container = $('#container');
  container.empty();
  var template = document.querySelector('#' + name + 'Template').content;
  var clone = document.importNode(template, true);
  container[0].appendChild(clone);
  if ($('#nav-' + name).hasClass('nav-item')) {
    $('#nav-open').text("Tasks");
  } else {
    $('#nav-open').text("Back");
  }
}

function hideActivePage() {
  $('#container').hide();
}

function updatePage(name) {
  resetCompPage();
  resetEvalPage();
  if (name === "help") {
    $("#help-scores button").click(function (event) {
      var parts = this.id.split('-');
      var score = parts[parts.length-1];
      var title = "You're score is " + score + "!";
      var msg = "Note that this dialog won't be shown during the evaluation."
              + " It is stored in the database instead.";
      alert(title + "\n\n" + msg);
    });
  } else if (name === "open") {
    updateOpenPage();
  } else if (name === "eval") {
    initEvalPage(global.initialMeshId, global.whiteMeshId);
  } else if (name === "comp") {
    initCompPage("WhiteMatterSurfaceComparison", global.initialMeshId, global.whiteMeshId);
  }
}

function showPage(name) {
  $("html").off('keyup');
  $('#container').hide();
  changeNavLink(name);
  changeTemplate(name);
  updatePage(name);
  $('#container').show();
}

function activePage() {
  var link = $('.navbar .nav-item.active');
  if (link.length === 1) {
    return link.attr('id').split('-')[1];
  } else {
    return '';
  }
}

function enableNavLink(name) {
  $("#nav-" + name).removeClass("disabled");
  $('.navbar').off('click', '#nav-' + name).on('click', '#nav-' + name, function (event) {
    showPage(name);
    return false;
  });
}

function disableNavLink(name) {
  $('.navbar').off('click', '#nav-' + name);
  $("#nav-" + name).addClass("disabled");
}

function enableTask(name) {
  var selector = '#' + name;
  $(selector + " .btn").removeClass("disabled");
  $(selector).off('click', '.btn').on('click', '.btn', function (event) {
    showPage(name);
    return false;
  });
}

function disableTask(name) {
  var selector = '#' + name;
  $(selector).off('click', '.btn');
  $(selector + " .btn").addClass("disabled");
}

function enablePage(name) {
  if (name === 'help' || name === 'open') {
    enableNavLink(name);
  } else if (global.raterId > 0 && activePage() === "open") {
    enableTask(name);
  }
}

function disablePage(name) {
  if (name === 'help' || name == 'open') {
    disableNavLink(name);
  } else {
    disableTask(name);
  }
}

// ----------------------------------------------------------------------------
// Start
function supportsTemplate() {
  return 'content' in document.createElement('template');
}

if (supportsTemplate()) {
  $(document).ready(function () {
    enablePage("help");
    enablePage("open");
    disablePage("eval");
    disablePage("comp");
    showPage(startPage);
  });
} else {
  showErrorMessage("template HTML tag not supported");
}

// ----------------------------------------------------------------------------
// Open database
function chooseDatabase(input) {
  var chooser = $(input);
  chooser.off('change');
  chooser.change(function(event) {
    openDatabase($(this).val())
  });
  chooser.trigger('click');  
}

function openDatabase(db_file) {
  global.raterId = 0;
  global.dbFile = db_file;
  global.imgBase = path.dirname(db_file);
  global.dbPrev = global.db;
  global.db = new sql.Database(db_file, function (err) {
    if (err) {
      showErrorMessage(err);
    } else {
      if (global.dbPrev) {
        global.dbPrev.close();
        global.dbPrev = null;
      }
      updateOpenPage();
    }
  });
}

function onLogIn(err, row) {
  if (err) {
    showErrorMessage(err);
  } else if (row) {
    clearErrors();
    var raterId = row['RaterId'];
    if (raterId) {
      global.raterId = raterId;
      if (row['ShowHelp']) {
        global.db.run("UPDATE Raters SET ShowHelp = 0 WHERE RaterId = ?", global.raterId, function (err) {
          if (err) showErrorMessage(err);
        });
        showPage("help");
      } else {
        updateOpenPage();
      }
    } else {
      showError("Missing 'RaterId' column in 'Raters' table");
    }
  } else {
    showError("Error: Unknown email address or password not correct.");
  }
  clearPasswordField();
}

function clearPasswordField() {
  $("#raterPassword").val("");
}

function updateSummary() {
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryTotalNumberOfComparisonSets([global.initialMeshId, global.whiteMeshId]);
  queryRemainingNumberOfComparisonSets([global.initialMeshId, global.whiteMeshId]);
  $("#summary").show();
}

function getMailToLink() {
  if (global.dbFile) {
    return contactMailTo + "&body=PLEASE ATTACH FILE: " + global.dbFile;
  } else {
    return contactMailTo;
  }
}

function updateOpenPage() {
  $('.contact').text(contactName);
  if (global.dbFile) {
    $('#mail').attr('href', getMailToLink());
    $('#mail').removeClass('disabled');
  } else {
    $('#mail').removeAttr('href');
    $('#mail').addClass('disabled');
  }
  var loginForm = $('#loginForm');
  loginForm.off("submit");
  if (global.raterId > 0) {
    loginForm.hide();
    enablePage("eval");
    enablePage("comp");
    updateSummary();
  } else {
    disablePage("eval");
    disablePage("comp");
    $("#summary").hide();
    if (global.db) {
      loginForm.off("submit").submit(function(event) {
        global.db.get("SELECT RaterId, ShowHelp FROM Raters WHERE Email = $email AND Password = $password",
                      { $email: $('#raterEmail').val(), $password: $('#raterPassword').val() }, onLogIn);
        event.preventDefault();
      });
      loginForm.show();
    } else {
      loginForm.hide();
    }
  }
}

// ----------------------------------------------------------------------------
// Auxiliaries for all task pages
function appendScreenshot(err, row) {
  if (err) {
    showErrorMessage(err);
  } else {
    var img = $("#screenshots .orthogonal-views ." + row['ViewId'] + " img[src='']");
    if (img.length == 0) {
      var template = document.querySelector('#orthogonalViewsTemplate').content;
      views = document.importNode(template, true);
      div = $("#screenshots").append(views);
      img = div.find("." + row['ViewId'] + " img[src='']");
    }
    img = img.first();
    img.attr('src', 'file://' + path.join(global.imgBase, row['FileName']));
    img.attr('alt', "Screenshot " + row['ScreenshotId']);
  }
}

function clearScreenshots() {
  $("#screenshots").empty();
}

function showDoneMessage() {
  var alerts = $('#alerts');
  if (alerts.children('.alert-success').length === 0) {
    showSuccess(`<strong>Congratulation!</strong> You've completed this task.
                <br />Thank you for rating these results.`);
  }
}

// ----------------------------------------------------------------------------
// Progress for both summary and evaluation pages
function queryTotalNumberOfEvaluationSets() {
  global.db.get(`
    SELECT COUNT(DISTINCT A.EvaluationSetId) AS NumTotal FROM EvaluationSets AS A
    INNER JOIN ScreenshotOverlays AS B
    ON A.ScreenshotId = B.ScreenshotId
      AND B.OverlayId IN ($initialMeshId, $whiteMeshId)
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
        ON C.ScreenshotId = D.ScreenshotId
        AND D.OverlayId NOT IN ($initialMeshId, $whiteMeshId)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 1
      )`,
    {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId
    }, setTotalNumberOfEvaluationSets);
}

function queryRemainingNumberOfEvaluationSets() {
  global.db.get(`
    SELECT COUNT(DISTINCT(A.EvaluationSetId)) AS NumRemaining FROM EvaluationSets AS A
    LEFT JOIN ` + getEvalTableName(global.initialMeshId) + ` AS I
      ON I.EvaluationSetId = A.EvaluationSetId AND I.RaterId = $raterId
    LEFT JOIN ` + getEvalTableName(global.whiteMeshId) + ` AS W
      ON W.EvaluationSetId = A.EvaluationSetId AND W.RaterId = $raterId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND ((B.OverlayId = $initialMeshId AND I.PerceptualScore IS NULL) OR
           (B.OverlayId = $whiteMeshId   AND W.PerceptualScore IS NULL))
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND D.OverlayId NOT IN ($initialMeshId, $whiteMeshId)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 1
      )`,
    {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId,
      $raterId: global.raterId
    }, setRemainingNumberOfEvaluationSets);
}

function queryTotalNumberOfComparisonSets(overlayIds) {
  if (!overlayIds || overlayIds.length == 0) {
    overlayIds = global.compOverlayIds;
  }
  global.db.get(`
    SELECT COUNT(DISTINCT A.EvaluationSetId) AS NumTotal FROM EvaluationSets AS A
    INNER JOIN ScreenshotOverlays AS B
    ON A.ScreenshotId = B.ScreenshotId
      AND ` + sqlValueInSet("B.OverlayId", "IN", overlayIds) + `
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
        ON C.ScreenshotId = D.ScreenshotId
        AND ` + sqlValueInSet("D.OverlayId", "NOT IN", overlayIds) + `
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> ` + overlayIds.length + `
      )`, setTotalNumberOfComparisonSets);
}

function queryRemainingNumberOfComparisonSets(overlayIds) {
  if (!overlayIds || overlayIds.length == 0) {
    overlayIds = global.compOverlayIds;
  }
  global.db.get(`
    SELECT COUNT(DISTINCT(A.EvaluationSetId)) AS NumRemaining FROM EvaluationSets AS A
    LEFT JOIN WhiteMatterSurfaceComparison AS S
      ON S.EvaluationSetId = A.EvaluationSetId AND S.RaterId = $raterId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND S.BestOverlayId IS NULL
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND ` + sqlValueInSet("D.OverlayId", "NOT IN", overlayIds) + `
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> ` + overlayIds.length + `
      )`, { $raterId: global.raterId },
    setRemainingNumberOfComparisonSets);
}

function setTotalNumberOfEvaluationSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".eval .total").text(res['NumTotal'].toString());
    updatePercentageOfEvaluationSetsDone();
  }
}

function setRemainingNumberOfEvaluationSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".eval .remaining").text(res['NumRemaining'].toString());
    updatePercentageOfEvaluationSetsDone();
  }
}

function setTotalNumberOfComparisonSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".comp .total").text(res['NumTotal'].toString());
    updatePercentageOfComparisonSetsDone();
  }
}

function setRemainingNumberOfComparisonSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".comp .remaining").text(res['NumRemaining'].toString());
    updatePercentageOfComparisonSetsDone();
  }
}

function updatePercentageOfEvaluationSetsDone() {
  var m = parseInt($(".eval .remaining").text());
  var n = parseInt($(".eval .total").text());
  if (isNaN(m) || isNaN(n)) {
    $(".eval .done").text('0%');
  } else {
    var v = (100 - m/n * 100).toFixed(0) + '%';
    if (v == '100%' && activePage() == 'open') {
      v = 'Completed!';
    }
    $(".eval .done").text(v);   
  }
}

function updatePercentageOfComparisonSetsDone() {
  var m = parseInt($(".comp .remaining").text());
  var n = parseInt($(".comp .total").text());
  if (isNaN(m) || isNaN(n)) {
    $(".comp .done").text('0%');
  } else {
    var v = (100 - m/n * 100).toFixed(0) + '%';
    if (v == '100%' && activePage() == 'open') {
      v = 'Completed!';
    }
    $(".comp .done").text(v);
  }
}

// ----------------------------------------------------------------------------
// Evaluation of single surface
function getEvalTableName(overlayId) {
  var overlay = global.overlayId;
  if (overlayId) {
    overlay = overlayId;
  }
  if (overlay == global.initialMeshId) {
    return "InitialSurfaceScores";
  } else if (overlay == global.whiteMeshId) {
    return "WhiteMatterSurfaceScores";
  } else if (overlay == global.v2mMeshId) {
    return "Vol2MeshSurfaceScores";
  } else {
    return null;
  }
}

function queryRemainingOverlays() {
  var query = "SELECT DISTINCT(B.OverlayId) FROM EvaluationSets AS A"
  for (var i = 0; i < global.evalOverlayIds.length; i++) {
    query += " LEFT JOIN " + getEvalTableName(global.evalOverlayIds[i]) + " AS S" + i +
      " ON S" + i + ".EvaluationSetId = A.EvaluationSetId AND S" + i + ".RaterId = $raterId";
  }
  query += " INNER JOIN ScreenshotOverlays AS B ON A.ScreenshotId = B.ScreenshotId AND (";
  for (var i = 0; i < global.evalOverlayIds.length; i++) {
    if (i > 0) query += " OR ";
    query += "(B.OverlayId = " + global.evalOverlayIds[i] + " AND S" + i + ".PerceptualScore IS NULL)";
  }
  query += `) AND A.EvaluationSetId NOT IN (
              SELECT EvaluationSetId FROM EvaluationSets AS C
              INNER JOIN ScreenshotOverlays AS D
                ON C.ScreenshotId = D.ScreenshotId
                AND ` + sqlValueInSet("D.OverlayId", "NOT IN", global.evalOverlayIds) + `
            )
            AND A.EvaluationSetId NOT IN (
              SELECT EvaluationSetId FROM EvaluationSets AS E
              INNER JOIN ScreenshotOverlays AS F
              ON E.ScreenshotId = F.ScreenshotId
              GROUP BY EvaluationSetId
              HAVING COUNT(DISTINCT OverlayId) <> 1
            )`;
  global.db.all(query, { $raterId: global.raterId }, queryNextEvaluationSet);
}

function queryNextEvaluationSet(err, rows) {
  if (err) {
    showErrorMessage(err);
  } else if (rows.length === 0) {
    hideActivePage();
    showDoneMessage();
  } else {
    global.overlayId = rows[Math.floor(Math.random() * rows.length)]['OverlayId'];
    global.db.all(`
      SELECT A.EvaluationSetId AS NextSetId FROM EvaluationSets AS A
      LEFT JOIN ` + getEvalTableName() + ` AS S
        ON S.EvaluationSetId = A.EvaluationSetId AND S.RaterId = $raterId
      INNER JOIN ScreenshotOverlays AS B
        ON A.ScreenshotId = B.ScreenshotId
        AND (B.OverlayId = $overlayId AND S.PerceptualScore IS NULL)
        AND A.EvaluationSetId NOT IN (
          SELECT EvaluationSetId FROM EvaluationSets AS C
          INNER JOIN ScreenshotOverlays AS D
            ON C.ScreenshotId = D.ScreenshotId
            AND D.OverlayId <> $overlayId
        )
        AND A.EvaluationSetId NOT IN (
          SELECT EvaluationSetId FROM EvaluationSets AS E
          INNER JOIN ScreenshotOverlays AS F
          ON E.ScreenshotId = F.ScreenshotId
          GROUP BY EvaluationSetId
          HAVING COUNT(DISTINCT OverlayId) <> 1
        )
      GROUP BY A.EvaluationSetId`, {
        $overlayId: global.overlayId,
        $raterId: global.raterId
      }, showNextEvaluationSet);
  }
}

function showNextEvaluationSet(err, rows) {
  if (err) {
    showErrorMessage(err);
  } else if (rows.length === 0) {
    hideActivePage();
    showDoneMessage();
  } else {
    global.evalSetId = rows[Math.floor(Math.random() * rows.length)]['NextSetId'];
    global.db.each(`
      SELECT A.ScreenshotId, A.ViewId, A.FileName FROM Screenshots AS A
      INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = $evalSetId
    `, { $evalSetId: global.evalSetId }, appendScreenshot, onEvalPageReady);
  }
}

function onEvalPageReady() {
  $("#scores button").click(function (event) {
    var parts = this.id.split('-');
    var score = parseInt(parts[parts.length-1]);
    saveQualityScore(score, updateEvalPage);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    // "1" or [bB]ad
    if (event.which == 49 || event.which == 66) {
      saveQualityScore(1, updateEvalPage);
    }
    // "2" or [pP]ad
    else if (event.which == 50 || event.which == 80) {
      saveQualityScore(2, updateEvalPage);
    }
    // "3" or [fF]ir
    else if (event.which == 51 || event.which == 70) {
      saveQualityScore(3, updateEvalPage);
    }
    // "4" or [gG]ood
    else if (event.which == 52 || event.which == 71) {
      saveQualityScore(4, updateEvalPage);
    }
    // "5" or [eE]xcellent
    else if (event.which == 53 || event.which == 69) {
      saveQualityScore(5, updateEvalPage); 
    }
    event.preventDefault();
    return false;
  });
  $("#eval").show();
}

function saveQualityScore(score, callback) {
  $("html").off("keyup");
  $("#scores button").off("click");
  global.db.run("INSERT INTO " + getEvalTableName() +
                " (EvaluationSetId, RaterId, PerceptualScore)" +
                " VALUES ($set, $rater, $score)",
    {
      $set: global.evalSetId,
      $rater: global.raterId,
      $score: score
    }, callback);
}

function initEvalPage() {
  global.evalOverlayIds = Array.prototype.slice.call(arguments);
  updateEvalPage();
}

function updateEvalPage() {
  $("#eval").hide();
  clearScreenshots();
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryRemainingOverlays();
  $("#eval").show();
}

function resetEvalPage() {
  global.evalSetId = 0;
  global.evalOverlayIds = [];
}

// ----------------------------------------------------------------------------
// Comparison of two surfaces
function queryOverlayColors(compSetId, overlayId, callback) {
  global.db.all(`
    SELECT DISTINCT(Color) AS Color
    FROM ScreenshotOverlays AS O
    INNER JOIN EvaluationSets AS E
      ON O.ScreenshotId = E.ScreenshotId
    WHERE EvaluationSetId = $compSetId AND OverlayId = $overlayId`,
    { $compSetId: compSetId, $overlayId: overlayId }, callback);
}

function queryDistinctOverlayColors(compSetId, callback) {
  global.db.all(`
    SELECT DISTINCT(Color) AS Color
    FROM Screenshots AS S
    INNER JOIN EvaluationSets AS E
      ON S.ScreenshotId = E.ScreenshotId
      AND EvaluationSetId = $compSetId
    LEFT JOIN ScreenshotOverlays AS O
      ON S.ScreenshotId = O.ScreenshotId
    ORDER BY Color`,
    { $compSetId: compSetId }, callback);
}

function queryNextComparisonSet() {
  global.db.get(`
    SELECT A.EvaluationSetId AS NextSetId FROM EvaluationSets AS A
    LEFT JOIN ` + global.compTableName + ` AS S
      ON S.EvaluationSetId = A.EvaluationSetId AND S.RaterId = $raterId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND S.BestOverlayId IS NULL
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND ` + sqlValueInSet("D.OverlayId", "NOT IN", global.compOverlayIds) + `
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> ` + global.compOverlayIds.length + `
      )
    GROUP BY A.EvaluationSetId`, {
      $raterId: global.raterId
    }, queryCompChoiceColors);
}

function queryCompChoiceColors(err, row) {
  if (err) {
    showErrorMessage(err);
  } else if (row) {
    global.compSetId = row['NextSetId'];
    queryDistinctOverlayColors(global.compSetId, setCompChoiceColors);
  } else {
    hideActivePage();
    showDoneMessage();
  }
}

function setCompChoiceColors(err, rows) {
  if (err) {
    showErrorMessage(err);
  } else {
    global.compColors = [null, null];
    if (rows.length == 2) {
      for (var i = 0; i < rows.length; i++) {
        setCompChoiceColor(i, rows[i]['Color']);
      }
      showNextComparisonSet(reorderCompOverlayIds);
    } else {
      global.compOverlayIds = shuffle(global.compOverlayIds);
      for (var i = 0; i < global.compOverlayIds.length; i++) {
        queryOverlayColors(global.compSetId, global.compOverlayIds[i], function (err, rows) {
          setCompChoiceColor(i, err, rows);
        });
      }
      showNextComparisonSet(onCompPageReady);
    }
  }
}

function setCompChoiceColor(i) {
  var color = undefined;
  if (arguments.length == 3) {
    var err  = arguments[1];
    var rows = arguments[2];
    if (err) {
      showSqlError("Failed to retrieve color of overlay with ID " + global.compOverlayId[i], err);
    } else if (rows.length != 1) {
      showErrorMessage("Overlay with ID " + global.compOverlayId[i] + " must have unique color in all shown screenshots");
    } else {
      color = rows[0]['Color'];
    }
  } else {
    color = arguments[1];
  }
  global.compColors[i] = color;
  $("#choice-" + i).css('background-color', color);
}

function showNextComparisonSet(callback) {
  global.db.each(`
    SELECT A.ScreenshotId, A.ViewId, A.FileName FROM Screenshots AS A
    INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = ?
  `, global.compSetId, appendScreenshot, callback);
}

function reorderCompOverlayIds() {
  queryOverlayColors(global.compSetId, global.compOverlayIds[0], function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else if (rows.length != 1) {
      showErrorMessage("Contours must have unique and identical color in all screenshots");
    } else {
      var color = rows[0]['Color'];
      var colorA = colorToHex($('#choice-0').css('background-color'));
      var colorB = colorToHex($('#choice-1').css('background-color'));
      if (colorA == color || colorB == color) {
        if (color == colorB) {
          var overlayId = global.compOverlayIds[0];
          global.compOverlayIds[0] = global.compOverlayIds[1];
          global.compOverlayIds[1] = overlayId;
        }
        onCompPageReady();
      } else {
        showError("<strong>Internal error:</strong> Colors of buttons A/B do not match color of " +
                  " first overlay, which has color " + color + ", whereas the colors of buttons A and B are " +
                  colorA + " and " + colorB + ", respectively!");
      }
    }
  });
}

function onCompPageReady() {
  $("#choice button").click(function (event) {
    var parts = this.id.split('-');
    var choice = parseInt(parts[parts.length-1]);
    saveBestOverlayChoice(choice, updateCompPage);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    // left arraw or a/A
    if (event.which == 37 || event.which == 65) {
      saveBestOverlayChoice(0, updateCompPage);
    }
    // right arraw or b/B
    else if (event.which == 39 || event.which == 66) {
      saveBestOverlayChoice(1, updateCompPage);
    }
    // up/down arraw or n/N
    else if (event.which == 38 || event.which == 40 || event.which == 78) {
      saveBestOverlayChoice(2, updateCompPage);
    }
    event.preventDefault();
    return false;
  });
  $("#comp").show();
}

function saveBestOverlayChoice(choice, callback) {
  $("html").off('keyup');
  $("#choice button").off('click');
  var bestOverlayId = global.neitherMeshId;
  if (0 <= choice && choice < global.compOverlayIds.length) {
    bestOverlayId = global.compOverlayIds[choice];
  }
  global.db.run("INSERT INTO " + global.compTableName +
                " (EvaluationSetId, RaterId, BestOverlayId) VALUES ($set, $rater, $best)",
    {
      $set: global.compSetId,
      $rater: global.raterId,
      $best: bestOverlayId
    }, callback);
}

function initCompPage(tableName) {
  global.compTableName = tableName;
  global.compOverlayIds = Array.prototype.slice.call(arguments, 1);
  updateCompPage();
}

function updateCompPage() {
  $("#comp").hide();
  $("#choice button").off('click');
  clearScreenshots();
  queryTotalNumberOfComparisonSets();
  queryRemainingNumberOfComparisonSets();
  queryNextComparisonSet();
}

function resetCompPage() {
  global.compSetId = 0;
  global.compTableName = '';
  global.compOverlayIds = [];
  global.compColors = [];
}
