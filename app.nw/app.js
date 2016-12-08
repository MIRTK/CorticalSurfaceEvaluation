var path = require('path');
var sql = require('sqlite3');

var startPage = "open";
var contactName = "Andreas Schuh";
var contactMailTo = "mailto:andreas.schuh@imperial.ac.uk?subject=Neonatal cortex evaluation"

global.initialMeshId = 3;
global.initialMeshColor = undefined;

global.whiteMeshId = 4;
global.whiteMeshColor = undefined;

global.db = null;
global.dbPrev = null;
global.dbFile = null;
global.imgBase = null;
global.evalSetId = 0;
global.raterId = 0;
global.overlayId = 0;

// When the comparison set contains just screenshots where only two colors
// are used for the overlaid initial and white matter surface contours,
// these two colors are used for the two buttons of the respective choice.
// The buttons then never change color to not confuse the rater with two
// many color changes. The only two colors used for the overlays are set
// as button colors by initCompPage once. Otherwise, the button color
// corresponds to the respective overlay in the compOverlayIds array.
global.compColors = [];

// The following array is randomly shuffled in place by updateCompPage
// It is used to assign an overlay to one of the two choices (excl. "Neither").
global.compOverlayIds = [global.initialMeshId, global.whiteMeshId];


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
    updateEvalPage();
  } else if (name === "comp") {
    initCompPage();
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
  queryTotalNumberOfComparisonSets();
  queryRemainingNumberOfComparisonSets();
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
    enableCompPage();
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
// Initialization of overlay colors
function sqlValueInSet(column, values) {
  var cond = undefined;
  if (values instanceof Array) {
    if (values.length === 1) {
      return column + " = " + values[0];
    }
    var cond = column + " IN (";
    for (var i = 0; i < values.length; i++) {
      if (i > 0) cond += ", ";
      cond += values[i];
    }
    cond += ")";
  } else {
    cond = column + " = " + values;
  }
  return cond;
}

function queryOverlayColors(evalSetId, overlayId, callback) {
  global.db.all(`
    SELECT DISTINCT(Color) AS Color
    FROM ScreenshotOverlays AS O
    INNER JOIN EvaluationSets AS E
      ON O.ScreenshotId = E.ScreenshotId
    WHERE EvaluationSetId = $evalSetId AND OverlayId = $overlayId`,
    { $evalSetId: evalSetId, $overlayId: overlayId }, callback);
}

function queryDistinctOverlayColors(numOverlays, callback) {
  global.db.all(`
    SELECT DISTINCT(Color) AS Color
    FROM Screenshots AS S
    INNER JOIN EvaluationSets AS E
      ON S.ScreenshotId = E.ScreenshotId
    LEFT JOIN ScreenshotOverlays AS O
      ON S.ScreenshotId = O.ScreenshotId
    WHERE S.ScreenshotId NOT IN (
      SELECT ScreenshotId FROM ScreenshotOverlays
      GROUP BY ScreenshotId
      HAVING COUNT(DISTINCT OverlayId) <> $numOverlays
    ) AND S.ScreenshotId NOT IN (
      SELECT DISTINCT(ScreenshotId) FROM ScreenshotOverlays
      WHERE OverlayId NOT IN ($initialMeshId, $whiteMeshId)
    )`, {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId,
      $numOverlays: numOverlays
    }, callback);
}

function enableCompPage() {
  global.compColors = undefined;
  queryDistinctOverlayColors(2, function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else {
      if (rows.length === 2) {
        global.compColors = [rows[0]['Color'], rows[1]['Color']];
      } else {
        global.compColors = [];
      }
      enablePage("comp");
    }
  });
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

function queryTotalNumberOfComparisonSets() {
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
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )`,
    {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId
    }, setTotalNumberOfComparisonSets);
}

function queryRemainingNumberOfComparisonSets() {
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
          AND D.OverlayId NOT IN ($initialMeshId, $whiteMeshId)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )`,
    {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId,
      $raterId: global.raterId
    }, setRemainingNumberOfComparisonSets);
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
  var m_text = $(".eval .remaining").text();
  var n_text = $(".eval .total").text();
  if (m_text && n_text) {
    var m = parseInt($(".eval .remaining").text());
    var n = parseInt($(".eval .total").text());
    var v = (100 - m/n * 100).toFixed(0) + '%';
    if (v == '100%' && activePage() == 'open') {
      v = 'Completed!';
    }
    $(".eval .done").text(v);
  } else {
    $(".eval .done").text('0%');
  }
}

function updatePercentageOfComparisonSetsDone() {
  var m_text = $(".comp .remaining").text();
  var n_text = $(".comp .total").text();
  if (m_text && n_text) {
    var m = parseInt($(".comp .remaining").text());
    var n = parseInt($(".comp .total").text());
    var v = (100 - m/n * 100).toFixed(0) + '%';
    if (v == '100%' && activePage() == 'open') {
      v = 'Completed!';
    }
    $(".comp .done").text(v);
  } else {
    $(".comp .done").text('0%');
  }
}

// ----------------------------------------------------------------------------
// Evaluation of single surface
function getEvalTableName(overlayId) {
  var overlay = global.overlayId;
  if (overlayId) {
    overlay = overlayId;
  }
  if (overlay === global.initialMeshId) {
    return "InitialSurfaceScores";
  } else if (overlay === global.whiteMeshId) {
    return "WhiteMatterSurfaceScores";
  } else {
    return null;
  }
}

function queryRemainingOverlays() {
  global.db.all(`
    SELECT DISTINCT(B.OverlayId)
    FROM EvaluationSets AS A
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
      )`, {
        $initialMeshId: global.initialMeshId,
        $whiteMeshId: global.whiteMeshId,
        $raterId: global.raterId
      }, queryNextEvaluationSet);
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
    clearScreenshots();
    global.evalSetId = rows[Math.floor(Math.random() * rows.length)]['NextSetId'];
    global.db.each(`
      SELECT A.ScreenshotId, A.ViewId, A.FileName FROM Screenshots AS A
      INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = $evalSetId
    `, { $evalSetId: global.evalSetId }, appendScreenshot, onEvalPageReady);
  }
}

function onEvalPageReady() {
  $("#scores button").click(function (event) {
    var table = getEvalTableName();
    saveQualityScore(parseInt(this.id.split('-')[1]), updateEvalPage);
    event.preventDefault();
  });
  $("html").keyup(function (event) {
    // "1" or [bB]ad
    if (event.which == 49 || event.which == 66) {
      saveQualityScore(1, updateEvalPage);
      event.preventDefault();
      return false;
    }
    // "2" or [pP]ad
    if (event.which == 50 || event.which == 80) {
      saveQualityScore(2, updateEvalPage);
      event.preventDefault();
      return false;
    }
    // "3" or [fF]ir
    if (event.which == 51 || event.which == 70) {
      saveQualityScore(3, updateEvalPage);
      event.preventDefault();
      return false;
    }
    // "4" or [gG]ood
    if (event.which == 52 || event.which == 71) {
      saveQualityScore(4, updateEvalPage);
      event.preventDefault();
      return false;
    }
    // "5" or [eE]xcellent
    if (event.which == 53 || event.which == 69) {
      saveQualityScore(5, updateEvalPage);
      event.preventDefault();
      return false;
    }
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

function updateEvalPage() {
  $("#eval").hide();
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryRemainingOverlays();
  $("#eval").show();
}

// ----------------------------------------------------------------------------
// Comparison of two surfaces
function queryNextComparisonSet() {
  global.db.get(`
    SELECT A.EvaluationSetId AS NextSetId FROM EvaluationSets AS A
    LEFT JOIN WhiteMatterSurfaceComparison AS S
      ON S.EvaluationSetId = A.EvaluationSetId AND S.RaterId = $raterId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND S.BestOverlayId IS NULL
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
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )
    GROUP BY A.EvaluationSetId`, {
      $initialMeshId: global.initialMeshId,
      $whiteMeshId: global.whiteMeshId,
      $raterId: global.raterId
    }, showNextComparisonSet);
}

function showNextComparisonSet(err, row) {
  if (err) {
    showErrorMessage(err);
  } else if (row) {
    clearScreenshots();
    global.compSetId = row['NextSetId'];
    global.db.each(`
      SELECT A.ScreenshotId, A.ViewId, A.FileName FROM Screenshots AS A
      INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = ?
    `, row['NextSetId'], appendScreenshotAndChangeButtonColors, onScreenshotsRead);
  } else {
    hideActivePage();
    showDoneMessage();
  }
}

function appendScreenshotAndChangeButtonColors(err, row) {
  if (err) {
    showErrorMessage(err);
  } else {
    appendScreenshot(err, row);
    if (global.compColors.length != 2) {
      for (let i = 0; i < 2; i++) {
        global.db.get(`
          SELECT Color FROM ScreenshotOverlays
          WHERE ScreenshotId = $screenshotId AND OverlayId = $overlayId`,
          {
            $screenshotId: row['ScreenshotId'],
            $overlayId: global.compOverlayIds[i]
          },
          function (err, row) {
            if (err) {
              showErrorMessage(err);
            } else {
              $("#choice-" + i).css('background-color', row['Color']);
            }
          }
        );
      }
    }
  }
}

function onScreenshotsRead() {
  if (global.compColors.length == 2) {
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
          var meshName;
          if (global.compOverlayIds[0] == global.initialMeshId) {
            meshName = "initial surface";
          } else {
            meshName = "white matter surface";
          }
          showError("<strong>Internal error:</strong> Colors of buttons A/B do not match color of " +
            meshName + ", which has color " + color + ", while the colors of button A and B are " +
            colorA + " and " + colorB + ", respectively!"
          );
        }
      }
    });
  } else {
    onCompPageReady();
  }
}

function onCompPageReady() {
  $("#choice button").click(function (event) {
    var parts = this.id.split('-');
    var choice = parseInt(parts[parts.length-1]);
    var best = 0;
    if (choice === 2) {
      best = 1;
    } else {
      best = global.compOverlayIds[choice];
    }
    saveBestOverlayChoice(best, updateCompPage);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    // left arraw or a/A
    if (event.which == 37 || event.which == 65) {
      saveBestOverlayChoice(0, updateCompPage);
      event.preventDefault();
      return false;
    }
    // right arraw or b/B
    if (event.which == 39 || event.which == 66) {
      saveBestOverlayChoice(1, updateCompPage);
      event.preventDefault();
      return false;
    }
    // up/down arraw or n/N
    if (event.which == 38 || event.which == 40 || event.which == 78) {
      saveBestOverlayChoice(2, updateCompPage);
      event.preventDefault();
      return false;
    }
  });
  $("#comp").show();
}

function saveBestOverlayChoice(choice, callback) {
  $("html").off('keyup');
  $("#choice button").off('click');
  var bestOverlayId = 0;
  if (choice === 2) {
    bestOverlayId = 1;
  } else {
    bestOverlayId = global.compOverlayIds[choice];
  }
  global.db.run(`INSERT INTO WhiteMatterSurfaceComparison (EvaluationSetId, RaterId, BestOverlayId) VALUES ($set, $rater, $best)`,
    {
      $set: global.compSetId,
      $rater: global.raterId,
      $best: bestOverlayId
    }, callback);
}

function initCompPage() {
  if (global.compColors.length == 2) {
    global.compOverlayIds = [global.initialMeshId, global.whiteMeshId];
    $("#choice-0").css('background-color', global.compColors[0]);
    $("#choice-1").css('background-color', global.compColors[1]);
  }
  updateCompPage();
}

function updateCompPage() {
  $("#comp").hide();
  $("#choice button").off('click');
  if (global.compColors.length != 2) {
    global.compOverlayIds = shuffle(global.compOverlayIds);
  }
  queryTotalNumberOfComparisonSets();
  queryRemainingNumberOfComparisonSets();
  queryNextComparisonSet();
}
