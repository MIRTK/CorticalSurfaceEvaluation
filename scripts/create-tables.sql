------------------------------------------------------------------------------
--                             Enumerations                                 --
------------------------------------------------------------------------------

-- Table with contact information
CREATE TABLE Contacts
(
    ContactId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name VARCHAR(64) NOT NULL,
    Email VARCHAR(256) NOT NULL,
    Subject VARCHAR(64)
);

INSERT INTO Contacts (Name, Email, Subject)
VALUES ("Andreas Schuh", "andreas.schuh@imperial.ac.uk", "Neonatal cortex evaluation");

-- Enumeration of brain hemispheres
CREATE TABLE Hemispheres
(
    HemisphereId CHARACTER(1) PRIMARY KEY,
    Name CHARACTER(5) NOT NULL,
    Description VARCHAR(64),
    UNIQUE (Name)
);

INSERT INTO Hemispheres (HemisphereId, Name, Description)
VALUES ('R', 'Right', 'Right side of the cerebrum');

INSERT INTO Hemispheres (HemisphereId, Name, Description)
VALUES ('L', 'Left', 'Left side of the cerebrum');

-- Enumeration of views of the volume and/or surface meshes
CREATE TABLE Views
(
    ViewId CHARACTER(1) PRIMARY KEY,
    Name VARCHAR(12) NOT NULL,
    Description VARCHAR(255),
    UNIQUE (Name)
);

INSERT INTO Views (ViewId, Name, Description)
VALUES ('A', 'Axial', 'Axial image slice');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('C', 'Coronal', 'Coronal image slice');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('S', 'Sagittal', 'Sagittal image slice');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('M', 'Medial', 'Medial view of 3D surface render');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('L', 'Lateral', 'Lateral view of 3D surface render');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('F', 'Anterior', 'Anterior view of 3D surface render');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('B', 'Posterior', 'Posterior view of 3D surface render');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('T', 'Superior', 'Superior view of 3D surface render');

INSERT INTO Views (ViewId, Name, Description)
VALUES ('I', 'Inferior', 'Inferior view of 3D surface render');

-- Enumeration of image overlays
CREATE TABLE Overlays
(
    OverlayId INTEGER PRIMARY KEY,
    Name VARCHAR(64) NOT NULL,
    Description VARCHAR(255),
    UNIQUE (Name)
);

INSERT INTO Overlays (OverlayId, Name, Description)
VALUES (0, 'Neither',  'The invisible overlay, e.g., choose if neither real overlay is best');

INSERT INTO Overlays (OverlayId, Name, Description)
VALUES (1, 'ROI Bounds',  'The ROI bounding box of a zoomed in screenshot');

INSERT INTO Overlays (OverlayId, Name, Description)
VALUES (2, 'Initial surface',  'The initial surface of spherical topology reconstructed using the white matter segmentation');

INSERT INTO Overlays (OverlayId, Name, Description)
VALUES (3, 'White matter surface',  'The white matter surface obtained by deforming the initial surface mesh towards the image edges');

INSERT INTO Overlays (OverlayId, Name, Description)
VALUES (4, 'Vol2mesh surface', "The white matter surface obtained using Robert's vol2mesh binary");

-- Enumeration of allowed evaluation scores
CREATE TABLE Scores
(
    Value INTEGER PRIMARY KEY,  -- Numeric score value, the higher the better
    Label VARCHAR(20) NOT NULL, -- Verbal score, e.g., 'Good'
    Color CHARACTER(7),         -- Button color assigned with this score
    Keys VARCHAR(32),           -- Comma separated list of additional keyup event codes
    Description VARCHAR(500),   -- Explanation of when to assign this score
    UNIQUE (Label)
);

INSERT INTO Scores (Value, Label, Keys, Description)
VALUES (0, 'Discard', '40', 'No or insufficient contour seen in screenshot');

INSERT INTO Scores (Value, Label, Color, Description)
VALUES (1, 'Poor', '#f0ad4e', 'Contour substantially deviates from tissue boundary, missing gyri');

INSERT INTO Scores (Value, Label, Color, Keys, Description)
VALUES (2, 'Fair', '#5bc0de', '37', 'Contour mainly correct, but with some major mistakes');

INSERT INTO Scores (Value, Label, Color, Keys, Description)
VALUES (3, 'Good', '#0275d8', '38', 'Contour mainly correct, but with some minor mistakes');

INSERT INTO Scores (Value, Label, Color, Keys, Description)
VALUES (4, 'Excellent', '#5cb85c', '39', 'Contour follows the tissue boundary');

------------------------------------------------------------------------------
--                             Data tables                                  --
------------------------------------------------------------------------------

-- Table of (expert) raters
--
-- A unique email address is used for "login" at the web application with
-- a generated password assigned to each rater. The password is stored in
-- plain text and therefore cannot be changed by the user via the GUI.
CREATE TABLE Raters
(
    RaterId INTEGER PRIMARY KEY AUTOINCREMENT,
    Email VARCHAR(64) NOT NULL,
    Password CHAR(8) NOT NULL,
    FirstName VARCHAR(64) NOT NULL,
    LastName VARCHAR(64) NOT NULL,
    Affiliation VARCHAR(255),
    ShowHelp INTEGER DEFAULT 1,
    UNIQUE (Email)
);

-- Table which assigns unique Id to each unique pair of (SubjectId,SessionId)
CREATE TABLE Scans
(
    ScanId INTEGER PRIMARY KEY AUTOINCREMENT,
    SubjectId CHARACTER(11) NOT NULL,
    SessionId INTEGER NOT NULL,
    UNIQUE (SubjectId, SessionId)
);

-- Table of commands executed to select regions of interest
--
-- This table is in first place used to increase reproducibility and record
-- the arguments of the commands used to add rows to the ROIs table.
CREATE TABLE Commands
(
    CommandId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name VARCHAR(64) NOT NULL,
    Parameters VARCHAR(255),
    UNIQUE (Name, Parameters)
);

-- Table of image regions of interest from which screenshots are taken
--
-- These regions are extracted automatically based on some measurements
-- such as distance to segmentation boundary or chosen randomly. The
-- sampling script should ensure that ROIs do not overlap if not necessary
-- to reduce the number of regions, and hence screenshots to be rated.
--
-- The center and span of the region in each dimension are given in
-- world coordinates and mm units, respectively.
CREATE TABLE ROIs
(
    ROI_Id INTEGER PRIMARY KEY AUTOINCREMENT,
    ScanId INTEGER NOT NULL,
    CenterX REAL NOT NULL,
    CenterY REAL NOT NULL,
    CenterZ REAL NOT NULL,
    Span REAL,
    CommandId INTEGER,
    FOREIGN KEY (ScanId) REFERENCES Scans(ScanId)
    FOREIGN KEY (CommandId) REFERENCES Commands(CommandId)
);

-- Table of screenshots that have been pre-rendered to file
--
-- A screenshot is rendered from a specific region of interest
-- listed in the ROIs table. A list of optional overlays visible
-- in the screenshot together with properties used to render these
-- (i.e., color) is given by the ScreenshotOverlays table.
--
-- The voxel with indices (CenterI, CenterJ, CenterK) corresponds
-- to the center point of the image slice, unless the overlay is
-- the ROI bounding box. In this case, the voxel indices correspond
-- to the center of the bounding box instead. This is to enable
-- selecting a screenshot with bounding box overlay where the
-- bounding box shows the outline of a given screenshot.
-- See also ROIScreenshots view.
CREATE TABLE Screenshots
(
    ScreenshotId INTEGER PRIMARY KEY AUTOINCREMENT,
    ROI_Id INTEGER,
    CenterI INTEGER NOT NULL,
    CenterJ INTEGER NOT NULL,
    CenterK INTEGER NOT NULL,
    ViewId INTEGER NOT NULL,
    FileName VARCHAR(255) NOT NULL,
    FOREIGN KEY (ROI_Id) REFERENCES ROIs(ROI_Id),
    FOREIGN KEY (ViewId) REFERENCES Views(ViewId),
    UNIQUE (FileName)
);

-- Table of overlays visible in the referenced screenshots
--
-- This table links zero or more overlays to the screenshots
-- that have been rendered. An overlay may appear in more than
-- one screenshot, but only once in a specific screenshot.
-- Additional properties of the rendered overlay which help to
-- identify it such as in particular the hexadecimal color code
-- are also stored in this table.
CREATE TABLE ScreenshotOverlays
(
    ScreenshotId INTEGER NOT NULL,
    OverlayId INTEGER NOT NULL,
    Color CHARACTER(7),
    PRIMARY KEY (ScreenshotId, OverlayId),
    FOREIGN KEY (ScreenshotId) REFERENCES Screenshots(ScreenshotId)
    FOREIGN KEY (OverlayId) REFERENCES Overlays(OverlayId)
);

-- Table of screenshots with only ROI bounding box overlay
CREATE VIEW ROIScreenshots AS
SELECT S.*, O1.OverlayId FROM Screenshots AS S
LEFT JOIN ScreenshotOverlays AS O1 ON O1.ScreenshotId = S.ScreenshotId
LEFT JOIN ScreenshotOverlays AS O2 ON O2.ScreenshotId = S.ScreenshotId
    AND O2.OverlayId <> O1.OverlayId
WHERE O1.OverlayId = 1 AND O2.OverlayId IS NULL;

-- Table of screenshots with exactly one overlay to be evaluated
CREATE VIEW EvaluationScreenshots AS
SELECT S.*,
    O1.OverlayId   AS OverlayId,
    R.ScreenshotId AS ROIScreenshotId,
    R.FileName     AS ROIScreenshotName
FROM Screenshots AS S
LEFT JOIN ScreenshotOverlays AS O1 ON O1.ScreenshotId = S.ScreenshotId
LEFT JOIN ScreenshotOverlays AS O2 ON O2.ScreenshotId = S.ScreenshotId
    AND O2.OverlayId <> O1.OverlayId
LEFT JOIN ROIScreenshots AS R ON R.ROI_Id = S.ROI_Id
    AND R.CenterI = S.CenterI
    AND R.CenterJ = S.CenterJ
    AND R.CenterK = S.CenterK
    AND R.ViewId  = S.ViewId
WHERE O1.OverlayId NOT IN (0, 1) AND O1.Color = '#fff53d' AND O2.OverlayId IS NULL;

-- Table of screenshots with exactly one overlay to compare with another
CREATE VIEW IndividualComparisonScreenshots AS
SELECT S.*,
    O1.OverlayId   AS OverlayId,
    O1.Color       As Color,
    R.ScreenshotId AS ROIScreenshotId,
    R.FileName     AS ROIScreenshotName
FROM Screenshots AS S
LEFT JOIN ScreenshotOverlays AS O1 ON O1.ScreenshotId = S.ScreenshotId
LEFT JOIN ScreenshotOverlays AS O2 ON O2.ScreenshotId = S.ScreenshotId
    AND O2.OverlayId <> O1.OverlayId
LEFT JOIN ROIScreenshots AS R ON R.ROI_Id = S.ROI_Id
    AND R.CenterI = S.CenterI
    AND R.CenterJ = S.CenterJ
    AND R.CenterK = S.CenterK
    AND R.ViewId  = S.ViewId
WHERE O1.OverlayId NOT IN (0, 1) AND O1.Color <> '#fff53d' AND O2.OverlayId IS NULL;

-- Table of screenshots with exactly two overlays to compare
CREATE VIEW ComparisonScreenshots AS
SELECT S.*,
    O1.OverlayId AS OverlayId1,
    O1.Color     AS Color1,
    O2.OverlayId AS OverlayId2,
    O2.Color     AS Color2
FROM Screenshots AS S
LEFT JOIN ScreenshotOverlays AS O1 ON O1.ScreenshotId = S.ScreenshotId
LEFT JOIN ScreenshotOverlays AS O2 ON O2.ScreenshotId = S.ScreenshotId
LEFT JOIN ScreenshotOverlays AS O3 ON O3.ScreenshotId = S.ScreenshotId
    AND O3.OverlayId NOT IN (O1.OverlayId, O2.OverlayId)
WHERE O1.OverlayId NOT IN (0, 1) AND O1.OverlayId < O2.OverlayId AND O3.OverlayId IS NULL;

------------------------------------------------------------------------------
--                         Evaluation tables                                --
------------------------------------------------------------------------------

-- Table with IDs of overlays to be evaluated individually
CREATE TABLE EvaluationTasks
(
    EvaluationTaskId INTEGER NOT NULL,
    OverlayId INTEGER NOT NULL,
    FOREIGN KEY (OverlayId) REFERENCES ScreenshotOverlays(OverlayId)
);

INSERT INTO EvaluationTasks (EvaluationTaskId, OverlayId) VALUES (1, 3);
INSERT INTO EvaluationTasks (EvaluationTaskId, OverlayId) VALUES (1, 4);

-- Table of single overlay evaluation scores
CREATE TABLE EvaluationScores
(
    ScreenshotId INTEGER NOT NULL,
    RaterId INTEGER NOT NULL,
    Score INTEGER NOT NULL,
    PRIMARY KEY (ScreenshotId, RaterId),
    FOREIGN KEY (ScreenshotId) REFERENCES EvaluationScreenshots(ScreenshotId),
    FOREIGN KEY (Score) REFERENCES Scores(Value)
);

-- Table with pairs of overlays to be compared
CREATE TABLE ComparisonTasks
(
    ComparisonTaskId INTEGER PRIMARY KEY,
    OverlayId1 INTEGER NOT NULL,
    OverlayId2 INTEGER NOT NULL,
    FOREIGN KEY (OverlayId1) REFERENCES ScreenshotOverlays(OverlayId),
    FOREIGN KEY (OverlayId2) REFERENCES ScreenshotOverlays(OverlayId),
    UNIQUE (OverlayId1, OverlayId2)
);

INSERT INTO ComparisonTasks (ComparisonTaskId, OverlayId1, OverlayId2) VALUES (1, 3, 4);
INSERT INTO ComparisonTasks (ComparisonTaskId, OverlayId1, OverlayId2) VALUES (2, 3, 2);

-- Table of overlay comparison choices
CREATE TABLE ComparisonChoices
(
    ScreenshotId INTEGER NOT NULL,
    RaterId INTEGER NOT NULL,
    BestOverlayId INTEGER NOT NULL,
    PRIMARY KEY (ScreenshotId, RaterId),
    FOREIGN KEY (RaterId) REFERENCES Raters(RaterId),
    FOREIGN KEY (ScreenshotId) REFERENCES ComparisonScreenshots(ScreenshotId),
    FOREIGN KEY (BestOverlayId) REFERENCES Overlays(OverlayId)
);