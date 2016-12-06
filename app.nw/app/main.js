var sql = require('sqlite3');
var db_file = 'data/sqlite3.db';

function setRaterId(err, row) {
  if (err) {
    $("#errorMessage").text(err).show();
  } else if (row) {
    $("#errorMessage").hide();
    global.raterId = row['RaterId'];
  } else {
    $("#errorMessage").text("Error: Unknown email address or password not correct.").show();
  }
  $("#password").val("");
  goToHome();
}

$("#signIn").submit(function(event) {
  var email = $("#email").val();
  var password = $("#password").val();
  global.db.get("SELECT * FROM Raters WHERE Email='" + email + "' AND Password='" + password + "'", setRaterId);
  return false;
});


// open database and show application window on success
global.db = new sql.Database(db_file, function (err) {
  if (err) {
    alert(err);
  } else {
    nw.Window.open('dist/index.html', {
        position: 'center',
        min_width: 1200,
        min_height: 800
    }, showLoginPage);
  }
});
