var path = require('path');
var sql = require('sqlite3');

var startPage = "open";
var contactName = "Andreas Schuh";
var contactMailTo = "mailto:andreas.schuh@imperial.ac.uk?subject=Neonatal cortex evaluation"

global.initial_mesh_id = 3;
global.white_mesh_id = 4;

global.db = null;
global.dbPrev = null;
global.dbFile = null;
global.imgBase = null;
global.evalSetId = 0;
global.raterId = 0;
global.overlayId = 0;

// The following array is randomly shuffled in place by updateCompPage
// It is used to assign an overlay to one of the two choices (excl. "Neither").
global.compOverlayIds = [global.initial_mesh_id, global.white_mesh_id]


// ----------------------------------------------------------------------------
// Common auxiliary functions

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
    updateCompPage();
  }
}

function showPage(name) {
  $('#container').hide();
  changeNavLink(name);
  changeTemplate(name);
  updatePage(name);
  $('#container').show();
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
  } else {
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
    enablePage("comp");
    updateSummary();
  } else {
    disablePage("eval");
    disablePage("comp");
    $("#summary").hide();
    if (global.db) {
      loginForm.off("submit").submit(function(event) {
        global.db.get("SELECT RaterId, ShowHelp FROM Raters WHERE Email = ? AND Password = ?",
                      $('#raterEmail').val(), $('#raterPassword').val(), onLogIn);
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
    var div = $("#screenshots>.row").last();
    if (div.length === 0 || div.children("div").length === 3) {
      div = $("<div class='row'></div>").appendTo("#screenshots");
    }
    var template = document.querySelector('#screenshotTemplate').content;
    var clone = document.importNode(template, true);
    var img = $(clone).find('img');
    img.attr('src', 'file://' + path.join(global.imgBase, row['FileName']));
    img.attr('alt', "Screenshot " + row['ScreenshotId']);
    div.append(clone);
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
      AND B.OverlayId IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
        ON C.ScreenshotId = D.ScreenshotId
        AND D.OverlayId NOT IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 1
      )
  `, setTotalNumberOfEvaluationSets);
}

function queryRemainingNumberOfEvaluationSets() {
  global.db.get(`
    SELECT COUNT(DISTINCT(A.EvaluationSetId)) AS NumRemaining FROM EvaluationSets AS A
    LEFT JOIN ` + getEvalTableName(global.initial_mesh_id) + ` AS I
      ON I.EvaluationSetId = A.EvaluationSetId
    LEFT JOIN ` + getEvalTableName(global.white_mesh_id) + ` AS W
      ON W.EvaluationSetId = A.EvaluationSetId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND ((B.OverlayId = ` + global.initial_mesh_id + ` AND I.PerceptualScore IS NULL) OR
           (B.OverlayId = ` + global.white_mesh_id   + ` AND W.PerceptualScore IS NULL))
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND D.OverlayId NOT IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 1
      )
  `, setRemainingNumberOfEvaluationSets);
}

function queryTotalNumberOfComparisonSets() {
  global.db.get(`
    SELECT COUNT(DISTINCT A.EvaluationSetId) AS NumTotal FROM EvaluationSets AS A
    INNER JOIN ScreenshotOverlays AS B
    ON A.ScreenshotId = B.ScreenshotId
      AND B.OverlayId IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
        ON C.ScreenshotId = D.ScreenshotId
        AND D.OverlayId NOT IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )
  `, setTotalNumberOfComparisonSets);
}

function queryRemainingNumberOfComparisonSets() {
  global.db.get(`
    SELECT COUNT(DISTINCT(A.EvaluationSetId)) AS NumRemaining FROM EvaluationSets AS A
    LEFT JOIN WhiteMatterSurfaceComparison AS S
      ON S.EvaluationSetId = A.EvaluationSetId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND S.BestOverlayId IS NULL
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND D.OverlayId NOT IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )
  `, setRemainingNumberOfComparisonSets);
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
    if (v === '100%' && $('#nav-open').hasClass('active')) {
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
    if (v === '100%' && $('#nav-open').hasClass('active')) {
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
  if (overlay === global.initial_mesh_id) {
    return "InitialSurfaceScores";
  } else if (overlay === global.white_mesh_id) {
    return "WhiteMatterSurfaceScores";
  } else {
    return null;
  }
}

function queryRemainingOverlays() {
  global.db.all(`
    SELECT DISTINCT(B.OverlayId)
    FROM EvaluationSets AS A
    LEFT JOIN ` + getEvalTableName(global.initial_mesh_id) + ` AS I
      ON I.EvaluationSetId = A.EvaluationSetId
    LEFT JOIN ` + getEvalTableName(global.white_mesh_id) + ` AS W
      ON W.EvaluationSetId = A.EvaluationSetId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND ((B.OverlayId = ` + global.initial_mesh_id + ` AND I.PerceptualScore IS NULL) OR
           (B.OverlayId = ` + global.white_mesh_id   + ` AND W.PerceptualScore IS NULL))
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND D.OverlayId NOT IN (` + global.initial_mesh_id + ', ' + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 1
      )
  `, queryNextEvaluationSet);
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
        ON S.EvaluationSetId = A.EvaluationSetId
      INNER JOIN ScreenshotOverlays AS B
        ON A.ScreenshotId = B.ScreenshotId
        AND (B.OverlayId = ` + global.overlayId + ` AND S.PerceptualScore IS NULL)
        AND A.EvaluationSetId NOT IN (
          SELECT EvaluationSetId FROM EvaluationSets AS C
          INNER JOIN ScreenshotOverlays AS D
            ON C.ScreenshotId = D.ScreenshotId
            AND D.OverlayId <> ` + global.overlayId + `
        )
        AND A.EvaluationSetId NOT IN (
          SELECT EvaluationSetId FROM EvaluationSets AS E
          INNER JOIN ScreenshotOverlays AS F
          ON E.ScreenshotId = F.ScreenshotId
          GROUP BY EvaluationSetId
          HAVING COUNT(DISTINCT OverlayId) <> 1
        )
      GROUP BY A.EvaluationSetId
    `, showNextEvaluationSet);
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
      INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = ?
    `, global.evalSetId, appendScreenshot, onEvalPageReady);
  }
}

function onEvalPageReady() {
  $("#scores button").off('click').click(function (event) {
    var table = getEvalTableName();
    var score = parseInt(this.id.split('-')[1]);
    global.db.run(`INSERT INTO ` + table + ` (EvaluationSetId, RaterId, PerceptualScore) VALUES ($set, $rater, $score)`,
      {
        $set: global.evalSetId,
        $rater: global.raterId,
        $score: score
      }, updateEvalPage);
    event.preventDefault();
  });
  $("#eval").show();
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
      ON S.EvaluationSetId = A.EvaluationSetId
    INNER JOIN ScreenshotOverlays AS B
      ON A.ScreenshotId = B.ScreenshotId
      AND S.BestOverlayId IS NULL
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS C
        INNER JOIN ScreenshotOverlays AS D
          ON C.ScreenshotId = D.ScreenshotId
          AND D.OverlayId NOT IN (` + global.initial_mesh_id + ", " + global.white_mesh_id + `)
      )
      AND A.EvaluationSetId NOT IN (
        SELECT EvaluationSetId FROM EvaluationSets AS E
        INNER JOIN ScreenshotOverlays AS F
        ON E.ScreenshotId = F.ScreenshotId
        GROUP BY EvaluationSetId
        HAVING COUNT(DISTINCT OverlayId) <> 2
      )
    GROUP BY A.EvaluationSetId
  `, showNextComparisonSet);
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
    `, row['NextSetId'], appendScreenshotAndChangeButtonColors, onCompPageReady);
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
    for (let i = 0; i < 2; i++) {
      global.db.get(`
        SELECT Color FROM ScreenshotOverlays
        WHERE ScreenshotId = ? AND OverlayId = ?`,
        row['ScreenshotId'], global.compOverlayIds[i],
        function (err, row) {
          if (err) {
            showErrorMessage(err);
          } else {
            var btn = $("#choice-" + i);
            btn.css('background-color', row['Color']);
          }
        }
      );
    }
  }
}

function onCompPageReady() {
  $("#choice button").off('click').click(function (event) {
    var parts = this.id.split('-');
    var choice = parseInt(parts[parts.length-1]);
    var best = 0;
    if (choice === 2) {
      best = 1;
    } else {
      best = global.compOverlayIds[choice];
    }
    global.db.run(`INSERT INTO WhiteMatterSurfaceComparison (EvaluationSetId, RaterId, BestOverlayId) VALUES ($set, $rater, $best)`,
      {
        $set: global.compSetId,
        $rater: global.raterId,
        $best: best
      }, updateCompPage);
    event.preventDefault();
    return false;
  });
  $("#comp").show();
}

function updateCompPage() {
  global.compOverlayIds = shuffle(global.compOverlayIds);
  $("#comp").hide();
  queryTotalNumberOfComparisonSets();
  queryRemainingNumberOfComparisonSets();
  queryNextComparisonSet();
}
