var path = require('path');
var sql = require('sqlite3');

global.initial_mesh_id = 3;
global.white_mesh_id = 4;

global.evalSetId = 0;
global.raterId = 0;
global.overlayId = 0;
global.imgBase = null;

// ----------------------------------------------------------------------------
// Common auxiliary functions
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
  $("#nav-" + name).addClass("active");
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

function showHelpPage() {
  $('#container').hide();
  changeNavLink("help");
  changeTemplate("help");
  $('#container').show();
  return false;
}

function showOpenPage() {
  $('#container').hide();
  changeNavLink("open");
  changeTemplate("open");
  updateOpenPage();
  $('#container').show();
  return false;
}

function showEvalPage() {
  $('#container').hide();
  changeTemplate("eval");
  updateEvalPage();
  $('#container').show();
  return false;
}

function showCompPage() {
  $('#container').hide();
  changeTemplate("comp");
  updateCompPage();
  $('#container').show();
  return false;
}

function enableNavLink(name, callback) {
  $("#nav-" + name).removeClass("disabled");
  $('.navbar').on('click', '#nav-' + name, callback);
}

function disableNavLink(name, callback) {
  $('.navbar').off('click', '#nav-' + name, callback);
  $("#nav-" + name).addClass("disabled");
}

function enableTask(name) {
  var selector = '#' + name;
  $(selector + " .btn").removeClass("disabled");
  $(selector).on('click', '.btn', showEvalPage);
}

function disableTask(name) {
  var selector = '#' + name;
  $(selector).off('click', '.btn', showEvalPage);
  $(selector + " .btn").addClass("disabled");
}

function enablePage(name) {
  if (name === 'help') {
    enableNavLink(name, showHelpPage);
  } else if (name === 'open') {
    enableNavLink(name, showOpenPage);
  } else if (name === 'eval') {
    enableTask(name, showEvalPage);
  } else if (name === 'comp') {
    return; // TODO
    enableTask(name, showCompPage);
  }
}

function disablePage(name) {
  if (name === 'help') {
    disableNavLink(name, showHelpPage);
  } else if (name === 'open') {
    disableNavLink(name, showOpenPage);
  } else if (name === 'eval') {
    disableTask(name, showEvalPage);
  } else if (name === 'comp') {
    disableTask(name, showCompPage);
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
    showHelpPage();
  });
} else {
  showErrorMessage("template HTML tag not supported");
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
  global.imgBase = path.dirname(db_file);
  global.db = new sql.Database(db_file, function (err) {
    if (err) {
      showErrorMessage(err);
    } else {
      $("#chooseDatabase").hide();
      $("#loginForm").show();
    }
  });
}

function clearPasswordField() {
  $("#raterPassword").val("");
}

function updateSummary() {
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  $("#summary").show();
}

function updateOpenPage() {
  if (global.raterId > 0) {
    enablePage("eval");
    enablePage("comp");
    $("#loginForm").hide();
    $("#chooseDatabase>button.btn-primary").html("Choose a different database file");
    $("#chooseDatabase").show();
    updateSummary();
  } else {
    disablePage("eval");
    disablePage("comp");
    $("#summary").hide();
    $("#loginForm").hide();
    $("#chooseDatabase>button.btn-primary").html("Choose a database file");
    $("#chooseDatabase").show();
  }
}

function setRaterId(err, row) {
  if (err) {
    showErrorMessage(err);
  } else if (row) {
    clearErrors();
    var raterId = row['RaterId'];
    if (raterId) {
      global.raterId = raterId;
      updateOpenPage();
    } else {
      showError("Missing 'RaterId' column in 'Raters' table");
    }
  } else {
    showError("Error: Unknown email address or password not correct.");
  }
  clearPasswordField();
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

function clearScreenshots() {
  $("#screenshots").empty();
}

function disableEvalScoreToolbar() {
  $("#scores button").addClass('disabled');
  $("#scores button").off('click');
}

function hideEvalScoreToolbar() {
  $("#scores button").addClass('disabled');
  $("#scores button").off('click');
  $('#scores').hide();
}

function onEvalPageReady() {
  $("#scores button").click(function (event) {
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
  $("#scores button.disabled").removeClass('disabled');
  $("#eval").show();
}

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

function queryRemainingOverlaps() {
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
    hideEvalScoreToolbar();
    hideActivePage();
    var alerts = $('#alerts');
    if (alerts.children('.alert-success').length === 0) {
      showSuccess("<strong>Congratulation!</strong> You've completed this task.<br />" +
                  "Thanks for rating these images. Please continue with the next task.");
    }
  } else {
    global.overlayId = rows[Math.floor(Math.random() * rows.length)]['OverlayId'];
    global.db.get(`
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
    `, showNextEvaluationSet);
  }
}

function showNextEvaluationSet(err, row) {
  if (err) {
    showErrorMessage(err);
  } else {
    disableEvalScoreToolbar();
    clearScreenshots();
    global.evalSetId = row['NextSetId'];
    global.db.each(`
      SELECT A.ScreenshotId, A.ViewId, A.FileName FROM Screenshots AS A
      INNER JOIN EvaluationSets AS B ON A.ScreenshotId = B.ScreenshotId AND B.EvaluationSetId = ?
    `, row['NextSetId'], appendScreenshot, onEvalPageReady);
  }
}

function updateEvalPage() {
  $("#eval").hide();
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryRemainingOverlaps();
}
