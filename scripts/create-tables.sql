------------------------------------------------------------------------------
--                             Enumerations                                 --
------------------------------------------------------------------------------

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
    OverlayId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name VARCHAR(64) NOT NULL,
    Description VARCHAR(255),
    UNIQUE (Name)
);

INSERT INTO Overlays (Name, Description)
VALUES ('Neither',  'The invisible overlay, e.g., choose if neither real overlay is best');

INSERT INTO Overlays (Name, Description)
VALUES ('Segmentation boundary',  'The boundary of the white matter segmentation');

INSERT INTO Overlays (Name, Description)
VALUES ('Initial surface',  'The initial surface of spherical topology reconstructed using the white matter segmentation');

INSERT INTO Overlays (Name, Description)
VALUES ('White matter surface',  'The white matter surface obtained by deforming the initial surface mesh towards the image edges');

-- Enumeration of perceptual quality scores
CREATE TABLE PerceptualQuality
(
    Score INTEGER PRIMARY KEY,        -- Numeric score value, the higher the better
    VerbalScore VARCHAR(20) NOT NULL, -- e.g., 'Poor', 'Fair', 'Good',...
    Description VARCHAR(500),         -- Explanation of when to assign this score
    UNIQUE (VerbalScore)
);

INSERT INTO PerceptualQuality (Score, VerbalScore, Description)
VALUES (1, 'Bad', 'Contour appears to follow random, noisy, or other tissue edge far from target boundary');

INSERT INTO PerceptualQuality (Score, VerbalScore, Description)
VALUES (2, 'Poor', 'Contour substantially deviates from tissue boundary, at least in parts');

INSERT INTO PerceptualQuality (Score, VerbalScore, Description)
VALUES (3, 'Fair', 'Contour close to tissue boundary, but for the most part not with sub-pixel accuracy');

INSERT INTO PerceptualQuality (Score, VerbalScore, Description)
VALUES (4, 'Good', 'Contour depicts tissue boundary for the most part with only minor irregularities');

INSERT INTO PerceptualQuality (Score, VerbalScore, Description)
VALUES (5, 'Excellent', 'Contour depicts tissue boundary within sub-pixel accuracy');

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

-- Table of image regions of interest to be rated
--
-- These regions are extracted automatically based on some measurements
-- such as distance to segmentation boundary or chosen randomly. The
-- sampling script should ensure that ROIs do not overlap if not necessary
-- to reduce the number of regions that need to be rated.
CREATE TABLE ROIs
(
    ROI_Id INTEGER PRIMARY KEY AUTOINCREMENT,
    ScanId INTEGER NOT NULL,
    CenterX REAL NOT NULL,
    CenterY REAL NOT NULL,
    CenterZ REAL NOT NULL,
    Size REAL,
    CommandId INTEGER,
    FOREIGN KEY (ScanId) REFERENCES Scans(ScanId)
    FOREIGN KEY (CommandId) REFERENCES Commands(CommandId)
);

-- Table of screenshots that have been pre-rendered to file
--
-- A screenshot is rendered from a specific regions of interest
-- listed in the Patches table. A list of optional overlays visible
-- in the screenshot together with properties used to render these
-- (e.g., the color) is maintained in the ScreenshotOverlays table.
CREATE TABLE Screenshots
(
    ScreenshotId INTEGER PRIMARY KEY AUTOINCREMENT,
    FileName VARCHAR(255) NOT NULL,
    ROI_Id INTEGER,
    ViewId INTEGER,
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

-- Table assigning screenshots to evaluation sets
--
-- An evaluation set consists of a set of screenshots that are
-- presented to the rater in one view and based on which the
-- rater assigns their score that summarizes the quality of
-- the result given the different examples. Such evaluation
-- set for example may consist of axial, coronal, and sagittal
-- views of the same ROI showing the same overlays.
CREATE TABLE EvaluationSets
(
    -- Columns
    ScreenshotId INTEGER NOT NULL,
    EvaluationSetId INTEGER NOT NULL,
    -- A screenshot may be shown in a given form at most once
    PRIMARY KEY (ScreenshotId, EvaluationSetId)
);

------------------------------------------------------------------------------
--                         Evaluation tables                                --
------------------------------------------------------------------------------

-- Table of initial white matter surface quality ratings
CREATE TABLE InitialSurfaceScores
(
    EvaluationSetId INTEGER NOT NULL,
    RaterId INTEGER NOT NULL,
    PerceptualScore INTEGER,
    PRIMARY KEY (EvaluationSetId, RaterId),
    FOREIGN KEY (PerceptualScore) REFERENCES PerceptualQuality(Score)
);

-- Table of reconstructed white matter surface quality ratings
CREATE TABLE WhiteMatterSurfaceScores
(
    EvaluationSetId INTEGER NOT NULL,
    RaterId INTEGER NOT NULL,
    PerceptualScore INTEGER,
    PRIMARY KEY (EvaluationSetId, RaterId),
    FOREIGN KEY (PerceptualScore) REFERENCES PerceptualQuality(Score)
);

-- Table of white matter surface quality ratings
CREATE TABLE WhiteMatterSurfaceComparison
(
    -- Columns
    EvaluationSetId INTEGER NOT NULL,
    RaterId INTEGER NOT NULL,
    BestOverlayId INTEGER,
    -- Each screenshot may be rated by a registered rater no more than once
    FOREIGN KEY (RaterId) REFERENCES Raters(RaterId),
    PRIMARY KEY (EvaluationSetId, RaterId),
    -- Each rater must select exactly one best overlay and give it unique score
    UNIQUE (EvaluationSetId, RaterId, BestOverlayId),
    -- Selected best overlay must be defined
    FOREIGN KEY (BestOverlayId) REFERENCES Overlays(OverlayId)
);