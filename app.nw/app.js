var path = require('path');
var sql = require('sqlite3');

var startPage = "open";
var contactName = "Andreas Schuh";
var contactMailTo = "mailto:andreas.schuh@imperial.ac.uk?subject=Neonatal cortex evaluation"

// Database and logged in rater
global.db = null;
global.dbPrev = null;
global.dbFile = null;
global.imgBase = null;
global.raterId = 0;

// IDs of overlays (see Overlays table)
global.bboxOverlayId = 1;
global.initialMeshId = 2;
global.whiteMeshId   = 3;
global.v2mMeshId     = 4;

// Current screenshot ID, used to restore page when temporarily switching
// to other page such as Help or Open summary page
global.activeScreenshotId = {};

// Current ROI screenshot ID, used to discard all screenshots corresponding
// to this region of interest when discarded during the evaluation task
global.activeROIScreenshotId = {};

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
  global.activeTaskName = '';
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
    initEvalPage("task1");
  } else if (name === "comp") {
    initCompPage("task2", global.initialMeshId, global.whiteMeshId);
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
  queryTotalNumberOfComparisonSets(global.initialMeshId, global.whiteMeshId);
  queryRemainingNumberOfComparisonSets(global.initialMeshId, global.whiteMeshId);
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
function setScreenshot(element_id, screenshotId, fileName) {
  var img = $("#" + element_id + " > img");
  img.attr('id', 'screenshot-' + screenshotId);
  img.attr('src', 'file://' + path.join(global.imgBase, fileName));
}

function setBoundsScreenshot(screenshotId, fileName) {
  setScreenshot("roi-bounds-view", screenshotId, fileName);
  global.activeROIScreenshotId[global.activeTaskName] = screenshotId;
}

function setZoomedScreenshot(screenshotId, fileName) {
  setScreenshot("zoomed-roi-view", screenshotId, fileName);
  global.activeScreenshotId[global.activeTaskName] = screenshotId;
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
  var query = "SELECT COUNT(ScreenshotId) AS N FROM EvaluationScreenshots";
  global.db.get(query, setTotalNumberOfEvaluationSets);
}

function queryRemainingNumberOfEvaluationSets() {
  var query = `
    SELECT COUNT(S.ScreenshotId) AS N
    FROM EvaluationScreenshots AS S
    LEFT JOIN EvaluationScores AS E
      ON S.ScreenshotId = E.ScreenshotId AND RaterId = $raterId
    WHERE Score IS NULL
  `;
  global.db.get(
    query,
    {
      $raterId: global.raterId
    },
    setRemainingNumberOfEvaluationSets);
}

function queryTotalNumberOfComparisonSets(overlayId1, overlayId2) {
  var id1, id2;
  if (arguments.length == 2) {
    id1 = Math.min(overlayId1, overlayId2);
    id2 = Math.max(overlayId1, overlayId2);
  } else {
    id1 = Math.min(global.compOverlayIds[0], global.compOverlayIds[1]);
    id2 = Math.max(global.compOverlayIds[0], global.compOverlayIds[1]);
  }
  var query = `
    SELECT COUNT(ScreenshotId) AS N FROM ComparisonScreenshots
    WHERE OverlayId1 = $id1 AND OverlayId2 = $id2
  `;
  global.db.get(
    query,
    {
      $id1: id1,
      $id2: id2
    },
    setTotalNumberOfComparisonSets);
}

function queryRemainingNumberOfComparisonSets(overlayId1, overlayId2) {
  var id1, id2;
  if (arguments.length == 2) {
    id1 = Math.min(overlayId1, overlayId2);
    id2 = Math.max(overlayId1, overlayId2);
  } else {
    id1 = Math.min(global.compOverlayIds[0], global.compOverlayIds[1]);
    id2 = Math.max(global.compOverlayIds[0], global.compOverlayIds[1]);
  }
  var query = `
    SELECT COUNT(S.ScreenshotId) AS N
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
    setRemainingNumberOfComparisonSets);
}

function setTotalNumberOfEvaluationSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".eval .total").text(res['N'].toString());
    updatePercentageOfEvaluationSetsDone();
  }
}

function setRemainingNumberOfEvaluationSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".eval .remaining").text(res['N'].toString());
    updatePercentageOfEvaluationSetsDone();
  }
}

function setTotalNumberOfComparisonSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".comp .total").text(res['N'].toString());
    updatePercentageOfComparisonSetsDone();
  }
}

function setRemainingNumberOfComparisonSets(err, res) {
  if (err) {
    showErrorMessage(err);
  } else {
    $(".comp .remaining").text(res['N'].toString());
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
// Evaluation of quality of single surface contour
function queryNextEvalScreenshot() {
  var query = `
    SELECT S.ScreenshotId AS ScreenshotId, FileName, ROIScreenshotId, ROIScreenshotName
    FROM EvaluationScreenshots AS S
    LEFT JOIN EvaluationScores AS E
      ON E.ScreenshotId = S.ScreenshotId AND RaterId = $raterId
    WHERE Score IS NULL
  `;
  var screenshotId = global.activeScreenshotId[global.activeTaskName];
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
    var score = parseInt(parts[parts.length-1]);
    saveQualityScore(score);
    event.preventDefault();
    return false;
  });
  $("html").keyup(function (event) {
    // "0" or [dD]iscard or arrow down
    if (event.which == 49 || event.which == 68 || event.which == 40) {
      saveQualityScore(0);
    }
    // "1" or [pP]oor or arrow left
    else if (event.which == 49 || event.which == 80 || event.which == 37) {
      saveQualityScore(1);
    }
    // "2" or [fF]ir or arrow up
    else if (event.which == 50 || event.which == 70 || event.which == 38) {
      saveQualityScore(2);
    }
    // "3" or [gG]ood or arrow right
    else if (event.which == 51 || event.which == 71 || event.which == 39) {
      saveQualityScore(3);
    }
    event.preventDefault();
    return false;
  });
  $("#eval").show();
}

function saveQualityScore(score) {
  $("html").off("keyup");
  $("#scores button").off("click");
  var query = '';
  if (score == 0) {
    var raterId = global.raterId;
    var roiId = global.activeROIScreenshotId[global.activeTaskName];
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
      SELECT S.ScreenshotId AS ScreenshotId, ` + raterId + ` AS RaterId, 0 AS BestOverlayId
      FROM ComparisonScreenshots AS S
      LEFT JOIN ComparisonChoices AS C
        ON C.ScreenshotId = S.ScreenshotId AND C.RaterId = ` + raterId + `
      WHERE C.BestOverlayId IS NULL AND S.ROIScreenshotId = ` + roiId + `;
    `;
    query += "END;"
  } else {
    var id = global.activeScreenshotId[global.activeTaskName];
    query  = "INSERT INTO EvaluationScores (ScreenshotId, RaterId, Score)";
    query += " VALUES (" + id + ", " + global.raterId + ", " + score + ")";
  }
  global.db.exec(query, onQualityScoreSaved);
}

function onQualityScoreSaved(err) {
  if (err) {
    global.db.exec('ROLLBACK;');
    hideActivePage();
    showErrorMessage(err);
  } else {
    global.activeScreenshotId   [global.activeTaskName] = 0;
    global.activeROIScreenshotId[global.activeTaskName] = 0;
    updateEvalPage();
  }
}

function initEvalPage(taskName) {
  global.activeTaskName = taskName;
  updateEvalPage();
}

function updateEvalPage() {
  $("#eval").hide();
  queryTotalNumberOfEvaluationSets();
  queryRemainingNumberOfEvaluationSets();
  queryNextEvalScreenshot();
}

// ----------------------------------------------------------------------------
// Comparison of two specific surfaces
function setCompButtonColor(i, color) {
  $("#choice-" + i).css('background-color', color);
}

function queryCompOverlayColors(callback) {
  var id1 = Math.min(global.compOverlayIds[0], global.compOverlayIds[1]);
  var id2 = Math.max(global.compOverlayIds[0], global.compOverlayIds[1]);
  var query = `
    SELECT DISTINCT(Color) AS Color FROM ScreenshotOverlays
    WHERE ScreenshotId IN (
      SELECT ScreenshotId FROM ComparisonScreenshots
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
  var id1 = Math.min(global.compOverlayIds[0], global.compOverlayIds[1]);
  var id2 = Math.max(global.compOverlayIds[0], global.compOverlayIds[1]);
  var screenshotId = global.activeScreenshotId[global.activeTaskName];
  var query = `
      SELECT
        S.ScreenshotId AS ScreenshotId, FileName,
        ScreenshotId1, FileName1, OverlayId1, Color1,
        ScreenshotId2, FileName2, OverlayId2, Color2,
        ROIScreenshotId, ROIScreenshotName
      FROM ComparisonScreenshots AS S
      LEFT JOIN ComparisonChoices AS C
        ON C.ScreenshotId = S.ScreenshotId AND RaterId = $raterId
      WHERE OverlayId1 = $id1 AND OverlayId2 = $id2 AND BestOverlayId IS NULL
    `;
  if (screenshotId) {
    query += " AND S.ScreenshotId = " + screenshotId;
  } else {
    query += "ORDER BY random() LIMIT 1";
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
            global.compOverlayIds = [overlay1, overlay2];
            setScreenshot("overlay1-view", screenshotId1, fileName1);
            setScreenshot("overlay2-view", screenshotId2, fileName2);
          } else if (global.compColors[0] == color2 && global.compColors[1] == color1) {
            global.compOverlayIds = [overlay2, overlay1];
            setScreenshot("overlay1-view", screenshotId2, fileName2);
            setScreenshot("overlay2-view", screenshotId1, fileName1);
          } else {
            err = "<strong>Internal error:</strong> Expected overlays to have either color " + global.compColors[0] +
                  " or color " + global.compColors[1] + ", but actual colors are " + color1 + " and " + color2 + " instead!";
          }
        } else {
          shuffle(global.compOverlayIds);
          if (global.compOverlayIds[0] == overlay1 && global.compOverlayIds[1] == overlay2) {
            setCompButtonColor(0, color1);
            setCompButtonColor(1, color2);
            setScreenshot("overlay1-view", screenshotId1, fileName1);
            setScreenshot("overlay2-view", screenshotId2, fileName2);
          } else if (global.compOverlayIds[0] == overlay2 && global.compOverlayIds[1] == overlay1) {
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
  $("#comp").show();
}

function saveBestOverlayChoice(choice) {
  $("html").off('keyup');
  $("#choice button").off('click');
  var bestOverlayId = 0;
  if (0 <= choice && choice < global.compOverlayIds.length) {
    bestOverlayId = global.compOverlayIds[choice];
  }
  var query = `
    INSERT INTO ComparisonChoices (ScreenshotId, RaterId, BestOverlayId)
    VALUES ($screenshotId, $raterId, $bestOverlayId)
  `;
  global.db.run(
    query,
    {
      $screenshotId: global.activeScreenshotId[global.activeTaskName],
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
    global.activeScreenshotId   [global.activeTaskName] = 0;
    global.activeROIScreenshotId[global.activeTaskName] = 0;
    updateCompPage();
  }
}

function initCompPage(taskName) {
  global.activeTaskName = taskName;
  global.compOverlayIds = Array.prototype.slice.call(arguments, 1);
  queryCompOverlayColors(updateCompPage);
}

function updateCompPage() {
  $("#comp").hide();
  queryTotalNumberOfComparisonSets();
  queryRemainingNumberOfComparisonSets();
  queryNextCompScreenshot();
}

function resetCompPage() {
  global.compOverlayIds = [];
  global.compColors = [];
}
