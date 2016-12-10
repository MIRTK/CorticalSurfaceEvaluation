#!/bin/bash

[ $# -eq 1 ] || [ $# -eq 3 ] || {
    echo "usage: $(basename "$BASH_SOURCE") <database> [<subject> <session>]"
}

DATABASE="$1"
if [ $# -eq 3 ]; then
  SUBJECT="$2"
  SESSION="$3"
else
  SUBJECT='CC00162XX06'
  SESSION='53600'
fi

BASE_DIR="$(dirname "$DATABASE")"
SCRIPT_DIR="$(dirname "$BASH_SOURCE")"

SUBJECTS_CSV="$HOME/Datasets/dHCP/Info/subjects-v2.csv"

IMAGE="$HOME/Experiments/dHCP/Surfaces/input/v2.3/dhcp-test/images/t2w/$SUBJECT-$SESSION.nii.gz"
INITIAL_SURFACE="$HOME/Experiments/dHCP/Surfaces/derived/v2.3/dhcp-test/$SUBJECT-$SESSION/meshes/cerebrum.vtp"
WHITE_MATTER_SURFACE="$HOME/Experiments/dHCP/Surfaces/derived/v2.3/dhcp-test/$SUBJECT-$SESSION/meshes/white.vtp"
SCREENSHOTS_DIR="$BASE_DIR/{subject}-{session}/screenshots"

MIN_INTENSITY=10
MAX_INTENSITY=30

VERBOSE_FLAGS='-v -v'

mkdir -p "$BASE_DIR" || exit 1

# initialize database
if [ ! -f "$DATABASE" ]; then
  "$SCRIPT_DIR/create-tables.py" "$DATABASE" || exit 1
  "$SCRIPT_DIR/import-scans.py" "$SUBJECTS_CSV" "$DATABASE" || exit 1
  "$SCRIPT_DIR/add-rater.py" "$DATABASE" \
      --email 'andreas.schuh@imperial.ac.uk' \
      --password 'test' \
      --first-name 'Andreas' \
      --last-name 'Schuh' \
      --affiliation 'Imperial College London' \
      || exit 1
fi

INITIAL_SURFACE_ID=$(sqlite3 "$DATABASE" "SELECT OverlayId FROM Overlays WHERE Name = 'Initial surface'")
WHITE_MATTER_SURFACE_ID=$(sqlite3 "$DATABASE" "SELECT OverlayId FROM Overlays WHERE Name = 'White matter surface'")

echo
echo "Initial surface ID      = $INITIAL_SURFACE_ID"
echo "White matter surface ID = $WHITE_MATTER_SURFACE_ID"
echo

# select regions of interest
get_number_of_rois()
{
  sqlite3 "$DATABASE" "
      SELECT COUNT(ROI_Id) AS NumROIs
      FROM ROIs INNER JOIN Scans
      ON ROIs.ScanId = Scans.ScanId
      AND SubjectId = '$SUBJECT' AND SessionId = $SESSION"
}
n=$(get_number_of_rois)
if [ $n -eq 0 ]; then
  "$SCRIPT_DIR/select-regions-of-interest.py" "$DATABASE" $VERBOSE_FLAGS \
      --subject "$SUBJECT" --session "$SESSION" \
      --surface "$WHITE_MATTER_SURFACE" --reference "$INITIAL_SURFACE" \
      --min-distance 1 --min-patch-size 10 --min-patch-area 1 --max-scan-rois 20 --roi-size 30 \
      || exit 1
  n=$(get_number_of_rois)
  echo -n "Added"
else
  echo -n "Found"
fi
echo " $n regions of interest in database"

# save screenshots of whole slices with bounding boxes overlaid
get_number_of_screenshots_with_bounding_boxes()
{
  sqlite3 "$DATABASE" "
    SELECT COUNT(ScreenshotId) AS NumScreenshots
    FROM ROIScreenshots AS S
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION"
}
n=$(get_number_of_screenshots_with_bounding_boxes)
if [ $n -eq 0 ]; then
  "$SCRIPT_DIR/take-screenshots-of-roi-bounds.py" "$DATABASE" $VERBOSE_FLAGS \
      --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
      --range $MIN_INTENSITY $MAX_INTENSITY \
      || exit 1
  n=$(get_number_of_screenshots_with_bounding_boxes)
  echo -n "Added"
else
  echo -n "Found"
fi
echo " $n screenshots with ROI bounding boxes in database"

# save screenshots with initial surface overlaid
get_number_of_screenshots_with_initial_surface()
{
  sqlite3 "$DATABASE" "
    SELECT COUNT(ScreenshotId) AS NumScreenshots
    FROM EvaluationScreenshots AS S
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION
    AND OverlayId = $INITIAL_SURFACE_ID"
}
n=$(get_number_of_screenshots_with_initial_surface)
if [ $n -eq 0 ]; then
  "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
      --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
      --overlay $INITIAL_SURFACE_ID "$INITIAL_SURFACE" \
      --prefix "$SCREENSHOTS_DIR/roi-initial-surface" \
      --range $MIN_INTENSITY $MAX_INTENSITY \
      || exit 1
  n=$(get_number_of_screenshots_with_initial_surface)
  echo -n "Added"
else
  echo -n "Found"
fi
echo " $n screenshots with initial surface overlaid in database"

# save screenshots with white matter surface overlaid
get_number_of_screenshots_with_white_matter_surface()
{
  sqlite3 "$DATABASE" "
    SELECT COUNT(ScreenshotId) AS NumScreenshots
    FROM EvaluationScreenshots AS S
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION
    AND OverlayId = $WHITE_MATTER_SURFACE_ID"
}
n=$(get_number_of_screenshots_with_white_matter_surface)
if [ $n -eq 0 ]; then
  "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
      --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
      --overlay $WHITE_MATTER_SURFACE_ID "$WHITE_MATTER_SURFACE" \
      --prefix "$SCREENSHOTS_DIR/roi-white-matter-surface" \
      --range $MIN_INTENSITY $MAX_INTENSITY \
      || exit 1
  n=$(get_number_of_screenshots_with_white_matter_surface)
  echo -n "Added"
else
  echo -n "Found"
fi
echo " $n screenshots with white matter surface overlaid in database"

# save screenshots with both initial and white matter surface overlaid
get_number_of_screenshots_with_initial_and_white_matter_surface()
{
  sqlite3 "$DATABASE" "
    SELECT COUNT(ScreenshotId) AS NumScreenshots
    FROM ComparisonScreenshots AS S
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION
    AND OverlayId1 = $INITIAL_SURFACE_ID
    AND OverlayId2 = $WHITE_MATTER_SURFACE_ID"
}
n=$(get_number_of_screenshots_with_initial_and_white_matter_surface)
if [ $n -eq 0 ]; then
  "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
      --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
      --overlay $INITIAL_SURFACE_ID "$INITIAL_SURFACE" \
      --overlay $WHITE_MATTER_SURFACE_ID "$WHITE_MATTER_SURFACE" \
      --prefix "$SCREENSHOTS_DIR/roi-initial-and-white-matter-surface" \
      --range $MIN_INTENSITY $MAX_INTENSITY --shuffle-colors \
      || exit 1
  n=$(get_number_of_screenshots_with_initial_and_white_matter_surface)
  echo -n "Added"
else
  echo -n "Found"
fi
echo " $n screenshots with both initial and white matter surfaces overlaid in database"