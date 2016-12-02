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

-- Enumeration of image region selection criteria
CREATE TABLE SelectionCriteria
(
    CriteriumId INTEGER PRIMARY KEY AUTOINCREMENT,
    Name VARCHAR(64) NOT NULL,
    Description VARCHAR(255),
    UNIQUE (Name)
);

------------------------------------------------------------------------------
--                             Data tables                                  --
------------------------------------------------------------------------------

-- Table which assigns unique Id to each unique pair of (SubjectId,SessionId)
CREATE TABLE Scans
(
    ScanId INTEGER PRIMARY KEY AUTOINCREMENT,
    SubjectId CHARACTER(11) NOT NULL,
    SessionId INTEGER NOT NULL,
    UNIQUE (SubjectId, SessionId)
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
    FOREIGN KEY (ScanId) REFERENCES Scans(ScanId)
);

-- Table of selection criteria based on which image region was selected
--
-- This table is used to keep track of the cirteria based on which
-- an image region of interest has been selected for evaluation.
CREATE TABLE ROISelectionCriteria
(
    ROI_Id INTEGER NOT NULL,
    CriteriumId INTEGER NOT NULL,
    PRIMARY KEY (ROI_Id, CriteriumId)
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

------------------------------------------------------------------------------
--                         Evaluation tables                                --
------------------------------------------------------------------------------

-- Table of (expert) raters
--
-- A unique email address is used for "login" at the web application.
-- No password or other authentication needed for this non-public app.
CREATE TABLE Raters
(
    RaterId INTEGER PRIMARY KEY AUTOINCREMENT,
    Email VARCHAR(64) NOT NULL,
    FirstName VARCHAR(64) NOT NULL,
    LastName VARCHAR(64) NOT NULL,
    Affiliation VARCHAR(255),
    UNIQUE (Email)
);

-- Table of allowed scores
CREATE TABLE Scores
(
    Score INTEGER PRIMARY KEY, -- Numeric score value
    VerbalScore VARCHAR(20),   -- e.g., 'Bad', 'Good',...
    Description VARCHAR(500),  -- Explanation of when to assign this score
    UNIQUE (VerbalScore)
);

-- Table of screenshots presented in a single comparison form
CREATE TABLE ComparisonScreenshots
(
    -- Columns
    ComparisonId INTEGER NOT NULL,
    ScreenshotId INTEGER NOT NULL,
    -- A screenshot may be shown in a given form at most once
    PRIMARY KEY (ComparisonId, ScreenshotId)
);

-- Table of white matter surface quality ratings
CREATE TABLE WhiteMatterSurfaceComparison
(
    -- Columns
    ComparisonId INTEGER NOT NULL, -- Comparison form on which this rating is based
    RaterId INTEGER NOT NULL,      -- Rater that assigned the score
    BestOverlayId INTEGER,         -- Which overlay depicts WM/cGM interface best?
    BestOverlayScore INTEGER,      -- How accurate does this overlay follow the boundary?
                                   -- Score may be used as weight when computing a weighted
                                   -- average of how often one or the other surface wins.
    -- Each screenshot may be rated by a registered rater no more than once
    FOREIGN KEY (RaterId) REFERENCES Raters(RaterId),
    PRIMARY KEY (ComparisonId, RaterId),
    -- Each rater must select exactly one best overlay and give it unique score
    CONSTRAINT UC_Best  UNIQUE (ComparisonId, RaterId, BestOverlayId),
    CONSTRAINT UC_Score UNIQUE (ComparisonId, RaterId, BestOverlayScore),
    -- Selected best overlay must be defined
    FOREIGN KEY (BestOverlayId) REFERENCES Overlays(OverlayId),
    -- Best overlay score must be a valid score
    FOREIGN KEY (BestOverlayScore) REFERENCES Scores(Score)
);