var path = require('path');
var sql = require('sqlite3');

// Database and logged in rater
global.db = null;
global.dbPrev = null;
global.dbFile = null;
global.imgBase = null;
global.raterId = 0;

// Evaluation Scores table entries
global.evalScores = [];

// Evaluation tasks and lists of corresponding overlay IDs
global.evalTaskIds = [];
global.evalOverlayIds = {};

// Comparison tasks with pairs of overlay IDs
global.compTaskIds = [];
global.compOverlayIds = {};

// Current screenshot ID, used to restore page when temporarily switching
// to other page such as Help or Open summary page
global.evalScreenshotId = {};
global.compScreenshotId = {};

// Current ROI screenshot ID, used to discard all screenshots corresponding
// to this region of interest when discarded during the evaluation task
global.evalROIScreenshotId = {};
global.compROIScreenshotId = {};

// When the comparison set contains just screenshots where only two colors
// are used for the two overlaid surface contours, these two colors are used
// for the two buttons of the respective choice. The buttons then never change
// color to not confuse the rater with two many color changes. Otherwise,
// this list is empty and the colors of the buttons is set each time to
// the color of the respective contour, instead.
global.compColors = [];


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

function showPage(name) {
  $("html").off('keyup');
  $('#nav-undo').hide();
  $('#container').hide();
  resetCompPage();
  global.activeTask = 0;
  if (name === "help") {
    changeNavLink(name);
    changeTemplate(name);
    updateHelpPage();
  } else if (name === "open") {
    changeNavLink(name);
    changeTemplate(name);
    updateOpenPage();
  } else if (name.substr(0, 5) === "eval-") {
    changeTemplate("eval");
    initEvalPage(name.split('-')[1]);
  } else if (name.substr(0, 5) === "comp-") {
    changeTemplate("comp");
    initCompPage(name.split('-')[1]);
  }
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

function getMailToLink() {
  var href = "";
  if (global.contactEmail) {
    href += "mailto:" + global.contactEmail;
  }
  if (global.contactSubject) {
    href += "?subject=" + global.contactSubject;
  }
  if (global.dbFile) {
    if (global.contactSubject) {
      href += "&";
    } else {
      href += "?";
    }
    href += "body=PLEASE ATTACH FILE: " + global.dbFile;
  }
  return href;
}

// ----------------------------------------------------------------------------
// Start
function supportsTemplate() {
  return 'content' in document.createElement('template');
}

if (supportsTemplate()) {
  $(document).ready(function () {
    enableNavLink("help");
    enableNavLink("open");
    showPage("open");
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

function onLogIn(event) {
  global.db.get(
    "SELECT RaterId, ShowHelp FROM Raters WHERE Email = $email AND Password = $password",
    {
      $email: $('#raterEmail').val(),
      $password: $('#raterPassword').val()
    },
    function (err, row) {
      if (err) {
        showErrorMessage(err);
      } else if (!row) {
        showError("Error: Unknown email address or password not correct.");
      } else {
        clearErrors();
        global.raterId = row['RaterId'];
        if (global.raterId) {
          loadContactInfo(function () {
          loadOverlayIds(function () {
          loadEvaluationScores(function () {
          loadEvaluationTasks(function () {
          loadComparisonTasks(function () {
            if (row['ShowHelp']) {
              global.db.run("UPDATE Raters SET ShowHelp = 0 WHERE RaterId = ?", global.raterId, function (err) {
                if (err) {
                  showErrorMessage(err);
                }
              });
              showPage("help");
            } else {
              updateOpenPage();
            }
          }) }) }) }) });
        } else {
          showError("Missing 'RaterId' column in 'Raters' table");
        }
      }
      clearPasswordField();
    }
  );
  event.preventDefault();
  return false;
}

function loadContactInfo(callback) {
  global.db.get("SELECT * FROM Contacts", function (err, row) {
    if (err) {
      showErrorMessage(err);
    } else if (!row) {
      global.contactName = "No Contact";
      global.contactEmail = "";
      global.contactSubject = "";
      callback();
    } else {
      global.contactName = row["Name"];
      global.contactEmail = row["Email"];
      global.contactSubject = row["Subject"];
      callback();
    }
  });
}

function loadOverlayIds(callback) {
  global.db.get("SELECT OverlayId FROM Overlays WHERE Name = 'ROI Bounds'", function (err, row) {
    if (err) {
      showErrorMessage(err);
    } else if (!row) {
      showErrorMessage("Missing 'ROI Bounds' overlay in Overlays table");
    } else {
      global.bboxOverlayId = row['OverlayId'];
      callback();
    }
  });
}

function loadEvaluationScores(callback) {
  global.db.all("SELECT * FROM Scores ORDER BY Value", function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else {
      global.evalScores = [];
      for (var i = 0; i < rows.length; i++) {
        score = {};
        score.value = rows[i]['Value'];
        score.label = rows[i]['Label'];
        score.color = rows[i]['Color'];
        score.descr = rows[i]['Description'];
        score.keys  = [];
        var keys = rows[i]['Keys'];
        if (keys) {
          codes = keys.split(',');
          for (var j = 0; j < codes.length; j++) {
            score.keys.push(parseInt(codes[j]));
          }
        }
        global.evalScores.push(score);
      }
      callback();
    }
  });
}

function loadEvaluationTasks(callback) {
  global.db.all("SELECT * FROM EvaluationTasks", function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else {
      global.evalTaskIds = [];
      global.evalOverlayIds = {};
      for (var i = 0; i < rows.length; i++) {
        var taskId = rows[i]['EvaluationTaskId'];
        if (!global.evalOverlayIds.hasOwnProperty(taskId)) {
          global.evalTaskIds.push(taskId);
        }
        global.evalOverlayIds[taskId] = [];
      }
      for (var i = 0; i < rows.length; i++) {
        var taskId = rows[i]['EvaluationTaskId'];
        global.evalOverlayIds[taskId].push(rows[i]['OverlayId']);
      }
      callback();
    }
  });
}

function loadComparisonTasks(callback) {
  global.db.all("SELECT * FROM ComparisonTasks", function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else {
      global.compTaskIds = [];
      global.compOverlayIds = {};
      for (var i = 0; i < rows.length; i++) {
        var taskId = rows[i]['ComparisonTaskId'];
        global.compTaskIds.push(taskId);
        global.compOverlayIds[taskId] = [
          rows[i]['OverlayId1'],
          rows[i]['OverlayId2']
        ];
      }
      callback();
    }
  });
}

function clearPasswordField() {
  $("#raterPassword").val("");
}

function addEvalTask(task) {
  var container = $('#summary tbody');
  var template = document.querySelector('#taskSummaryTemplate').content;
  var clone = document.importNode(template, true);
  container.append($(clone));
  $("#new-task").attr("id", "eval-" + task);
  var btn = $("#new-task-link");
  btn.attr("id", "eval-" + task + "-link");
  btn.text("Evaluation task " + task);
  btn.on("click", function (event) {
    showPage("eval-" + task);
    return false;
  });
}

function addCompTask(task) {
  var container = $('#summary tbody');
  var template = document.querySelector('#taskSummaryTemplate').content;
  var clone = document.importNode(template, true);
  container.append($(clone));
  $("#new-task").attr("id", "comp-" + task);
  var btn = $("#new-task-link");
  btn.attr("id", "comp-" + task + "-link");
  btn.text("Comparison task " + task);
  btn.on("click", function (event) {
    showPage("comp-" + task);
    return false;
  });
}

function updateSummary() {
  $("#summary").hide();
  $('#summary tbody').empty();
  if (global.raterId > 0) {
    for (var i = 0; i < global.evalTaskIds.length; i++) {
      var task = global.evalTaskIds[i];
      addEvalTask(task);
      queryTotalNumberOfEvaluationSets(task);
      queryRemainingNumberOfEvaluationSets(task);
    }
    for (var i = 0; i < global.compTaskIds.length; i++) {
      var task = global.compTaskIds[i];
      addCompTask(task);
      queryTotalNumberOfComparisonSets(task);
      queryRemainingNumberOfComparisonSets(task);
    }
    $("#summary").show();
  }
}

function updateOpenPage() {
  if (global.contactName) {
    $('#contact-name').text(global.contactName);
    if (global.contactEmail && global.dbFile) {
      $('#mailto-link').attr('href', getMailToLink());
      $('#mailto-link').removeClass('disabled');
    } else {
      $('#mailto-link').removeAttr('href');
      $('#mailto-link').addClass('disabled');
    }
    $('#mailto-notice').show();
  } else {
    $('#mailto-notice').hide();
  }
  var loginForm = $('#loginForm');
  loginForm.off("submit");
  if (global.raterId > 0) {
    loginForm.hide();
  } else {
    if (global.db) {
      loginForm.off("submit").submit(onLogIn);
      loginForm.show();
    } else {
      loginForm.hide();
    }
  }
  updateSummary();
}

function updateHelpPage() {
  if (global.db) {
    var scoresTable = $("#help-scores tbody");
    scoresTable.empty();
    for (var i = 0; i < global.evalScores.length; i++) {
      var score = global.evalScores[i];
      var btn = $('<button class="btn btn-score btn-block"></button>');
      btn.attr("id", "test-score-" + score.value);
      if (score.color) {
        btn.css("background-color", score.color);
      } else {
        btn.addClass("btn-default");
      }
      btn.html(getScoreButtonLabel(score));
      btn.click(function (event) {
        var parts = this.id.split('-');
        var score = parts[parts.length-1];
        var title = "You're score is " + score + "!";
        var msg = "Note that this dialog won't be shown during the evaluation."
                + " It is stored in the database instead.";
        alert(title + "\n\n" + msg);
      });
      var cell = $('<td></td>');
      cell.append(btn);
      var descr = $("<td></td>");
      descr.html(score.descr);
      var row = $("<tr></tr>");
      row.append(btn);
      row.append(descr);
      scoresTable.append(row);
    }
  }
}

// ----------------------------------------------------------------------------
// Auxiliaries for all task pages
function setScreenshot(element_id, screenshotId, fileName) {
  var img = $("#" + element_id + " > img");
  var absPath = path.join(global.imgBase, fileName);
  img.attr("id", "screenshot-" + screenshotId);
  img.attr("src", "file://" + absPath);
  img.attr("alt", "Image not found: " + fileName);
}

function setBoundsScreenshot(screenshotId, fileName) {
  setScreenshot("roi-bounds-view", screenshotId, fileName);
}

function setZoomedScreenshot(screenshotId, fileName) {
  setScreenshot("zoomed-roi-view", screenshotId, fileName);
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
function queryTotalNumberOfEvaluationSets(task) {
  var taskId = task;
  if (!taskId) taskId = global.activeTask;
  var query = `
    SELECT COUNT(DISTINCT(ScreenshotId)) AS N
    FROM EvaluationScreenshots
    WHERE ` + sqlValueInSet('OverlayId', 'IN', global.evalOverlayIds[taskId]);
  global.db.get(
    query,
    function (err, row) {
      if (err) {
        showErrorMessage(err);
      } else {
        setTotalNumberOfScreenshots("eval-" + taskId, row['N']);
      }
    }
  );
}

function queryRemainingNumberOfEvaluationSets(task) {
  var taskId = task;
  if (!taskId) taskId = global.activeTask;
  var query = `
    SELECT COUNT(DISTINCT(S.ScreenshotId)) AS N
    FROM EvaluationScreenshots AS S
    LEFT JOIN EvaluationScores AS E
      ON S.ScreenshotId = E.ScreenshotId AND RaterId = $raterId
    WHERE Score IS NULL AND ` + sqlValueInSet('OverlayId', 'IN', global.evalOverlayIds[taskId]);
  global.db.get(
    query,
    {
      $raterId: global.raterId
    },
    function (err, row) {
      if (err) {
        showErrorMessage(err);
      } else {
        setRemainingNumberOfScreenshots("eval-" + taskId, row['N']);
      }
    }
  );
}

function queryTotalNumberOfComparisonSets(task) {
  var overlayIds = global.compOverlayIds[task];
  var id1 = Math.min(overlayIds[0], overlayIds[1]);
  var id2 = Math.max(overlayIds[0], overlayIds[1]);
  var query = `
    SELECT COUNT(DISTINCT(ScreenshotId)) AS N FROM ComparisonScreenshots
    WHERE OverlayId1 = $id1 AND OverlayId2 = $id2
  `;
  global.db.get(
    query,
    {
      $id1: id1,
      $id2: id2
    },
    function (err, row) {
      if (err) {
        showErrorMessage(err);
      } else {
        var taskId = task;
        if (!taskId) taskId = global.activeTask;
        setTotalNumberOfScreenshots("comp-" + taskId, row['N']);
      }
    }
  );
}

function queryRemainingNumberOfComparisonSets(task) {
  var overlayIds = global.compOverlayIds[task];
  var id1 = Math.min(overlayIds[0], overlayIds[1]);
  var id2 = Math.max(overlayIds[0], overlayIds[1]);
  var query = `
    SELECT COUNT(DISTINCT(S.ScreenshotId)) AS N
    FROM ComparisonScreenshots AS S
    LEFT JOIN ComparisonChoices AS C
      ON S.ScreenshotId = C.ScreenshotId AND RaterId = $raterId
    WHERE OverlayId1 = $id1 AND OverlayId2 = $id2 AND BestOverlayId IS NULL
  `;
  global.db.get(
    query,
    {
      $raterId: global.raterId,
      $id1: id1,
      $id2: id2
    },
    function (err, row) {
      if (err) {
        showErrorMessage(err);
      } else {
        var taskId = task;
        if (!taskId) taskId = global.activeTask;
        setRemainingNumberOfScreenshots("comp-" + taskId, row['N']);
      }
    }
  );
}

function setTotalNumberOfScreenshots(taskName, num) {
  $("#" + taskName + " .total").text(num.toString());
  updatePercentageDone(taskName);
}

function setRemainingNumberOfScreenshots(taskName, num) {
  $("#" + taskName + " .remaining").text(num.toString());
  updatePercentageDone(taskName);
}

function updatePercentageDone(taskName) {
  var m = parseInt($("#" + taskName + " .remaining").text());
  var n = parseInt($("#" + taskName + " .total").text());
  if (isNaN(m) || isNaN(n)) {
    $("#" + taskName + " .done").text('0%');
  } else {
    var v;
    if (m == 0 && activePage() == 'open') {
      v = 'Completed!';
    } else {
      v = (100 - m/n * 100).toFixed(0) + '%';
    }
    $("#" + taskName + " .done").text(v);
  }
}

// ----------------------------------------------------------------------------
// Evaluation of quality of single surface contour
function queryNextEvalScreenshot() {
  var query = `
    SELECT S.ScreenshotId AS ScreenshotId, FileName, ROIScreenshotId, ROIScreenshotName
    FROM EvaluationScreenshots AS S
    LEFT JOIN EvaluationScores AS E
      ON E.ScreenshotId = S.ScreenshotId AND RaterId = $raterId
    WHERE Score IS NULL AND ` + sqlValueInSet('OverlayId', 'IN', global.evalOverlayIds[global.activeTask]) + `
  `;
  var screenshotId = global.evalScreenshotId[global.activeTask];
  if (screenshotId) {
    query += " AND S.ScreenshotId = " + screenshotId;
  } else {
    query += " ORDER BY random() LIMIT 1";
  }
  global.db.get(query, { $raterId: global.raterId }, function (err, row) {
    if (err) {
      showErrorMessage(err);
    } else if (row) {
      setBoundsScreenshot(row['ROIScreenshotId'], row['ROIScreenshotName']);
      setZoomedScreenshot(row['ScreenshotId'], row['FileName']);
      global.evalROIScreenshotId[global.activeTask] = row['ROIScreenshotId'];
      global.evalScreenshotId   [global.activeTask] = row['ScreenshotId'];
      showEvalPage();
    } else {
      hideActivePage();
      showDoneMessage();
    }
  });
}

function showEvalPage() {
  $("#scores button").click(function (event) {
    var parts = this.id.split('-');
    var value = parseInt(parts[parts.length-1]);
    saveQualityScore(value);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    event.preventDefault();
    for (var i = 0; i < global.evalScores.length; i++) {
      var score = global.evalScores[i];
      // 0..9
      if (48 <= event.which && event.which <= 57) {
        if (event.which - 48 == score.value) {
          saveQualityScore(score.value);
          return false;
        }
      }
      // A..Z
      else if (65 <= event.which && event.which <= 90) {
        if (score.label.charAt(0).toUpperCase().charCodeAt(0) == event.which) {
          saveQualityScore(score.value);
          return false;
        }
      }
      // custom key, e.g., arrow key
      for (var j = 0; j < score.keys.length; j++) {
        if (event.which == score.keys[j]) {
          saveQualityScore(score.value);
          return false;
        }
      }
    }
    return false;
  });
  $("#eval-" + global.activeTask).show();
}

function saveQualityScore(score) {
  $("html").off("keyup");
  $("#scores button").off("click");
  var query = '';
  if (score == 0) {
    var raterId = global.raterId;
    var roiId = global.evalROIScreenshotId[global.activeTask];
    query = "BEGIN;";
    // Discard all screenshots taken from the same ROI
    query += `
      INSERT INTO EvaluationScores (ScreenshotId, RaterId, Score)
      SELECT S.ScreenshotId AS ScreenshotId, ` + raterId + ` AS RaterId, 0 AS Score
      FROM EvaluationScreenshots AS S
      LEFT JOIN EvaluationScores AS E
        ON E.ScreenshotId = S.ScreenshotId AND E.RaterId = ` + raterId + `
      WHERE E.Score IS NULL AND S.ROIScreenshotId = ` + roiId + `;
    `;
    // Set choice of all comparisons within discarded ROI as "Neither"
    query += `
      INSERT INTO ComparisonChoices (ScreenshotId, RaterId, BestOverlayId)
      SELECT DISTINCT(S.ScreenshotId) AS ScreenshotId, ` + raterId + ` AS RaterId, 0 AS BestOverlayId
      FROM ComparisonScreenshots AS S
      LEFT JOIN ROIScreenshots AS R
        ON  R.ROI_Id  = S.ROI_Id
        AND R.CenterI = S.CenterI
        AND R.CenterJ = S.CenterJ
        AND R.CenterK = S.CenterK
        AND R.ViewId  = S.ViewId
      LEFT JOIN ComparisonChoices AS C
        ON C.ScreenshotId = S.ScreenshotId AND C.RaterId = ` + raterId + `
      WHERE C.BestOverlayId IS NULL AND R.ScreenshotId = ` + roiId + `;
    `;
    query += "END;"
  } else {
    var id = global.evalScreenshotId[global.activeTask];
    query  = "INSERT INTO EvaluationScores (ScreenshotId, RaterId, Score)";
    query += " VALUES (" + id + ", " + global.raterId + ", " + score + ")";
  }
  global.db.exec(query, onQualityScoreSaved);
}

function undoLastQualityScore()
{
  $("html").off("keyup");
  $("#scores button").off("click");
  var query = "SELECT ScreenshotId, Score FROM EvaluationScores WHERE RaterId = ";
  query += global.raterId + " ORDER BY _rowid_ DESC LIMIT 1";
  global.db.get(query, function (err, row) {
    if (err) {
      showErrorMessage(err);
    } else if (row['Score'] == 0) {
      showErrorMessage("Cannot undo Discard operation");
    } else {
      var id = row['ScreenshotId'];
      global.evalScreenshotId[global.activeTask] = id;
      global.db.run("DELETE FROM EvaluationScores WHERE ScreenshotId = " + id + " AND RaterId = " + global.raterId, function (err) {
        if (err) {
          showErrorMessage(err);
          global.evalScreenshotId[global.activeTask] = 0;
        } else {
          clearErrors();
          $('#container').show();
        }
        global.evalROIScreenshotId[global.activeTask] = 0;
        updateEvalPage();
      });
    }
  });
}

function onQualityScoreSaved(err) {
  if (err) {
    global.db.exec('ROLLBACK;');
    hideActivePage();
    showErrorMessage(err);
  } else {
    global.evalScreenshotId   [global.activeTask] = 0;
    global.evalROIScreenshotId[global.activeTask] = 0;
    updateEvalPage();
  }
}

function getScoreButtonLabel(score) {
  var label = score.value + "-<strong>" + score.label.charAt(0) + "</strong>" + score.label.substr(1);
  if (score.keys.length > 0) {
    var which = score.keys[0];
    if (which == 37) {
      label += " [left]";
    } else if (which == 38) {
      label += " [up]";
    } else if (which == 39) {
      label += " [right]";
    } else if (which == 40) {
      label += " [down]";
    }
  }
  return label;
}

function initEvalPage(task) {
  $("#container > div").attr("id", "eval-" + task);
  global.activeTask = task;
  var toolbar = $('#score-buttons');
  for (var i = 0; i < global.evalScores.length; i++) {
    var score = global.evalScores[i];
    var btn = $('<button id="score-1" type="button" class="btn">1-<strong>P</strong>oor [left]</button>');
    btn.attr("id", "score-" + score.value);
    if (score.color) {
      btn.css("background-color", score.color);
    } else {
      btn.addClass("btn-default");
    }
    btn.html(getScoreButtonLabel(score));
    if (score.value == 0) {
      $('#discard-button').append(btn);
    } else {
      toolbar.append(btn);
    }
  }
  updateEvalPage();
}

function updateUndoLink() {
  $('#nav-undo').off("click");
  $('#nav-undo').hide();
  var query = "SELECT * FROM EvaluationScores WHERE RaterId = " + global.raterId + " AND NOT Score IS NULL LIMIT 1";
  global.db.get(query, function (err, row) {
    if (err) {
      showErrorMessage(err);
    } else if (row) {
      $('#nav-undo').click(function (event) {
        undoLastQualityScore();
      });
      $('#nav-undo').show();
    }
  });
}

function updateEvalPage() {
  $("#eval-" + global.activeTask).hide();
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryNextEvalScreenshot();
  updateUndoLink();
}

// ----------------------------------------------------------------------------
// Comparison of two specific surfaces
function setCompButtonColor(i, color) {
  $("#choice-" + i).css('background-color', color);
}

function queryCompOverlayColors(callback) {
  var overlayId1 = global.compOverlayIds[global.activeTask][0];
  var overlayId2 = global.compOverlayIds[global.activeTask][1];
  var id1 = Math.min(overlayId1, overlayId2);
  var id2 = Math.max(overlayId1, overlayId2);
  var query = `
    SELECT DISTINCT(Color) AS Color FROM ScreenshotOverlays
    WHERE ScreenshotId IN (
      SELECT DISTINCT(ScreenshotId) FROM ComparisonScreenshots
      WHERE OverlayId1 = $id1 AND OverlayId2 = $id2
    )
    ORDER BY Color
  `;
  global.db.all(query, { $id1: id1, $id2: id2 }, function (err, rows) {
    if (err) {
      showErrorMessage(err);
    } else {
      global.compColors = [];
      for (var i = 0; i < rows.length; i++) {
        global.compColors.push(rows[i]['Color']);
      }
      callback();
    }
  });
}

function queryNextCompScreenshot() {
  var overlayId1 = global.compOverlayIds[global.activeTask][0];
  var overlayId2 = global.compOverlayIds[global.activeTask][1];
  var id1 = Math.min(overlayId1, overlayId2);
  var id2 = Math.max(overlayId1, overlayId2);
  var screenshotId = global.compScreenshotId[global.activeTask];
  var query = `
      SELECT
        S.ScreenshotId AS ScreenshotId,
        S.FileName AS FileName,
        A.ScreenshotId AS ScreenshotId1,
        A.FileName AS FileName1,
        A.OverlayId AS OverlayId1,
        A.Color AS Color1,
        B.ScreenshotId AS ScreenshotId2,
        B.FileName AS FileName2,
        B.OverlayId AS OverlayId2,
        B.Color AS Color2,
        R.ScreenshotId AS ROIScreenshotId,
        R.FileName AS ROIScreenshotName
      FROM ComparisonScreenshots AS S
      LEFT JOIN ROIScreenshots AS R
        ON  R.ROI_Id  = S.ROI_Id
        AND R.CenterI = S.CenterI
        AND R.CenterJ = S.CenterJ
        AND R.CenterK = S.CenterK
        AND R.ViewId  = S.ViewId
      LEFT JOIN IndividualComparisonScreenshots AS A
        ON  A.ROIScreenshotId = R.ScreenshotId
        AND A.OverlayId       = S.OverlayId1
        AND A.Color           = S.Color1
      LEFT JOIN IndividualComparisonScreenshots AS B
        ON  B.ROIScreenshotId = R.ScreenshotId
        AND B.OverlayId       = S.OverlayId2
        AND B.Color           = S.Color2
      LEFT JOIN ComparisonChoices AS C
        ON C.ScreenshotId = S.ScreenshotId AND C.RaterId = $raterId
      WHERE A.OverlayId = $id1 AND B.OverlayId = $id2 AND C.BestOverlayId IS NULL
    `;
  if (screenshotId) {
    query += " AND S.ScreenshotId = " + screenshotId + " GROUP BY S.ScreenshotId";
  } else {
    query += " GROUP BY S.ScreenshotId ORDER BY random() LIMIT 1";
  }
  global.db.get(query, { $raterId: global.raterId, $id1: id1, $id2: id2 }, function (err, row) {
      if (err) {
        hideActivePage();
        showErrorMessage(err);
      } else if (row) {
        var err = null;
        var color1 = row['Color1'];
        var color2 = row['Color2'];
        var overlay1 = row['OverlayId1'];
        var overlay2 = row['OverlayId2'];
        var screenshotId1 = row['ScreenshotId1'];
        var screenshotId2 = row['ScreenshotId2'];
        var fileName1 = row['FileName1'];
        var fileName2 = row['FileName2'];
        if (global.compColors.length == 2) {
          setCompButtonColor(0, global.compColors[0]);
          setCompButtonColor(1, global.compColors[1]);
          if (global.compColors[0] == color1 && global.compColors[1] == color2) {
            global.compOverlayIds[global.activeTask] = [overlay1, overlay2];
            setScreenshot("overlay1-view", screenshotId1, fileName1);
            setScreenshot("overlay2-view", screenshotId2, fileName2);
          } else if (global.compColors[0] == color2 && global.compColors[1] == color1) {
            global.compOverlayIds[global.activeTask] = [overlay2, overlay1];
            setScreenshot("overlay1-view", screenshotId2, fileName2);
            setScreenshot("overlay2-view", screenshotId1, fileName1);
          } else {
            err = "<strong>Internal error:</strong> Expected overlays to have either color " + global.compColors[0] +
                  " or color " + global.compColors[1] + ", but actual colors are " + color1 + " and " + color2 + " instead!";
          }
        } else {
          var overlayIds = [
            global.compOverlayIds[global.activeTask][0],
            global.compOverlayIds[global.activeTask][1]
          ];
          shuffle(overlayIds);
          if (overlayIds[0] == overlay1 && overlayIds[1] == overlay2) {
            setCompButtonColor(0, color1);
            setCompButtonColor(1, color2);
            setScreenshot("overlay1-view", screenshotId1, fileName1);
            setScreenshot("overlay2-view", screenshotId2, fileName2);
          } else if (overlayIds[0] == overlay2 && overlayIds[1] == overlay1) {
            setCompButtonColor(0, color2);
            setCompButtonColor(1, color1);
            setScreenshot("overlay1-view", screenshotId2, fileName2);
            setScreenshot("overlay2-view", screenshotId1, fileName1);
            order = [1, 0];
          } else {
            err = "<strong>Internal error:</strong> Expected overlays to have either color " + global.compColors[0] +
                  " or color " + global.compColors[1] + ", but actual colors are " + color1 + " and " + color2 + " instead!";
          }
        }
        if (err) {
          hideActivePage();
          showError(err);
        } else {
          setBoundsScreenshot(row['ROIScreenshotId'], row['ROIScreenshotName']);
          setZoomedScreenshot(row['ScreenshotId'], row['FileName']);
          global.compROIScreenshotId[global.activeTask] = row['ROIScreenshotId'];
          global.compScreenshotId   [global.activeTask] = row['ScreenshotId'];
          onCompPageReady();
        }
      } else {
        hideActivePage();
        showDoneMessage();
      }
    });
}

function onCompPageReady() {
  $("#choice button").click(function (event) {
    var parts = this.id.split('-');
    var choice = parseInt(parts[parts.length-1]);
    saveBestOverlayChoice(choice);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    // left arraw or a/A
    if (event.which == 37 || event.which == 65) {
      saveBestOverlayChoice(0);
    }
    // right arraw or b/B
    else if (event.which == 39 || event.which == 66) {
      saveBestOverlayChoice(1);
    }
    // up/down arraw or n/N
    else if (event.which == 38 || event.which == 40 || event.which == 78) {
      saveBestOverlayChoice(2);
    }
    event.preventDefault();
    return false;
  });
  $("#comp-" + global.activeTask).show();
}

function saveBestOverlayChoice(choice) {
  $("html").off('keyup');
  $("#choice button").off('click');
  var bestOverlayId = 0;
  if (0 <= choice && choice < global.compOverlayIds[global.activeTask].length) {
    bestOverlayId = global.compOverlayIds[global.activeTask][choice];
  }
  var query = `
    INSERT INTO ComparisonChoices (ScreenshotId, RaterId, BestOverlayId)
    VALUES ($screenshotId, $raterId, $bestOverlayId)
  `;
  global.db.run(
    query,
    {
      $screenshotId: global.compScreenshotId[global.activeTask],
      $raterId: global.raterId,
      $bestOverlayId: bestOverlayId
    },
    onBestOverlayChoiceSaved
  );
}

function onBestOverlayChoiceSaved(err) {
  if (err) {
    hideActivePage();
    showErrorMessage(err);
  } else {
    global.compScreenshotId   [global.activeTask] = 0;
    global.compROIScreenshotId[global.activeTask] = 0;
    updateCompPage();
  }
}

function initCompPage(task) {
  $("#container > div").attr("id", "comp-" + task);
  global.activeTask = task;
  queryCompOverlayColors(updateCompPage);
}

function updateCompPage() {
  $("#comp-" + global.activeTask).hide();
  queryTotalNumberOfComparisonSets(global.activeTask);
  queryRemainingNumberOfComparisonSets(global.activeTask);
  queryNextCompScreenshot();
}

function resetCompPage() {
  global.compColors = [];
}
