#!/bin/bash

[ $# -eq 2 ] || {
    echo "usage: $(basename "$BASH_SOURCE") <database> <sessions>"
    exit 1
}

DATABASE="$1"
SUBJECTS_CSV="$2"

DATABASE_DIR="$(dirname "$DATABASE")"
mkdir -p "$DATABASE_DIR" || exit 1
DATABASE_DIR="$(cd "$DATABASE_DIR" && pwd)"

SCRIPT_DIR="$(dirname "$BASH_SOURCE")"
SCRIPT_DIR="$(cd "$SCRIPT_DIR" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGES_DIR="$BASE_DIR/images/t2w"
SURFACES_DIR="$BASE_DIR/meshes/rev-88c8266"
SCREENSHOTS_DIR="$DATABASE_DIR/{subject}-{session}"
TEMP_DIR="$BASE_DIR/temp/populate-database"

VOL2MESH_DIR="$BASE_DIR/meshes/v2.3"

MIN_DISTANCE=(2 1)
ROI_SPAN=40
MAX_SCAN_ROIS=40
MAX_OVERLAP=80
MIN_INTENSITY=10
MAX_INTENSITY=30
NUM_SUBDIVS=0
ROI_OFFSETS=(0)
LINE_WIDTH=3

PRINT_COMMAND=true
VERBOSE_FLAGS='-v -v'


# -----------------------------------------------------------------------------
# initialize database
mkdir -p "$TEMP_DIR" || exit 1

if [ ! -f "$DATABASE" ]; then
  "$SCRIPT_DIR/create-tables.py" "$DATABASE" || exit 1
  "$SCRIPT_DIR/import-scans.py" "$SUBJECTS_CSV" "$DATABASE" || exit 1
fi

INITIAL_SURFACE_ID=$(sqlite3 "$DATABASE" "SELECT OverlayId FROM Overlays WHERE Name = 'Initial surface'")
WHITE_MATTER_SURFACE_ID=$(sqlite3 "$DATABASE" "SELECT OverlayId FROM Overlays WHERE Name = 'White matter surface'")
VOL2MESH_SURFACE_ID=$(sqlite3 "$DATABASE" "SELECT OverlayId FROM Overlays WHERE Name = 'Vol2mesh surface'")

echo
echo "Initial surface ID      = $INITIAL_SURFACE_ID"
echo "White matter surface ID = $WHITE_MATTER_SURFACE_ID"
echo "Vol2mesh surface ID     = $VOL2MESH_SURFACE_ID"

# -----------------------------------------------------------------------------
# auxiliaries to query state of database
run()
{
  if [ $PRINT_COMMAND = true ]; then
    echo
    echo "$@"
    echo
  fi
  "$@" || exit 1
}

get_number_of_rois()
{
  sqlite3 "$DATABASE" "\
      SELECT COUNT(ROI_Id) AS NumROIs \
      FROM ROIs INNER JOIN Scans \
      ON ROIs.ScanId = Scans.ScanId \
      AND SubjectId = '$SUBJECT' AND SessionId = $SESSION"
}

get_number_of_screenshots_with_bounding_boxes()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM ROIScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION"
}

get_number_of_screenshots_with_initial_surface()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM EvaluationScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION \
    AND OverlayId = $INITIAL_SURFACE_ID"
}

get_number_of_screenshots_with_white_matter_surface()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM EvaluationScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION \
    AND OverlayId = $WHITE_MATTER_SURFACE_ID"
}

get_number_of_screenshots_with_vol2mesh_surface()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM EvaluationScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION \
    AND OverlayId = $VOL2MESH_SURFACE_ID"
}

get_number_of_screenshots_with_initial_and_white_matter_surface()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM ComparisonScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION \
    AND OverlayId1 = $INITIAL_SURFACE_ID \
    AND OverlayId2 = $WHITE_MATTER_SURFACE_ID"
}

get_number_of_screenshots_with_vol2mesh_and_white_matter_surface()
{
  sqlite3 "$DATABASE" "\
    SELECT COUNT(ScreenshotId) AS NumScreenshots \
    FROM ComparisonScreenshots AS S \
    INNER JOIN ROIs  AS R ON R.ROI_Id = S.ROI_Id \
    INNER JOIN Scans AS I ON I.ScanId = R.ScanId \
    WHERE SubjectId = '$SUBJECT' AND SessionId = $SESSION \
    AND OverlayId1 = $WHITE_MATTER_SURFACE_ID \
    AND OverlayId2 = $VOL2MESH_SURFACE_ID"
}


# -----------------------------------------------------------------------------
while IFS=, read SUBJECT SESSION; do
  [ ${SUBJECT:0:2} = 'CC' ] || continue

  IMAGE="$IMAGES_DIR/$SUBJECT-${SESSION}.nii.gz"

  INITIAL_SURFACE="$SURFACES_DIR/$SUBJECT-$SESSION/cerebrum.vtp"
  INITIAL_SURFACE_RH="$SURFACES_DIR/$SUBJECT-$SESSION/cerebrum-rh.vtp"
  INITIAL_SURFACE_LH="$SURFACES_DIR/$SUBJECT-$SESSION/cerebrum-lh.vtp"

  WHITE_MATTER_SURFACE="$SURFACES_DIR/$SUBJECT-$SESSION/white+internal.vtp"
  WHITE_MATTER_SURFACE_RH="$SURFACES_DIR/$SUBJECT-$SESSION/white-rh.vtp"
  WHITE_MATTER_SURFACE_LH="$SURFACES_DIR/$SUBJECT-$SESSION/white-lh.vtp"

  VOL2MESH_SURFACE="$VOL2MESH_DIR/$SUBJECT-$SESSION-white.vtp"
  VOL2MESH_SURFACE_RH="$VOL2MESH_DIR/$SUBJECT-$SESSION-white-rh.vtp"
  VOL2MESH_SURFACE_LH="$VOL2MESH_DIR/$SUBJECT-$SESSION-white-lh.vtp"

  TEMP_SURFACE_RH="$TEMP_DIR/$SUBJECT-$SESSION-cortex-rh.vtp"
  TEMP_SURFACE_LH="$TEMP_DIR/$SUBJECT-$SESSION-cortex-lh.vtp"
  

  echo
  echo "Intensity image      = $IMAGE"
  echo "Initial surface      = $INITIAL_SURFACE"
  echo "White matter surface = $WHITE_MATTER_SURFACE"
  echo "Vol2mesh surface (R) = $VOL2MESH_SURFACE_RH"
  echo "Vol2mesh surface (L) = $VOL2MESH_SURFACE_LH"
  echo "Temporary directory  = $TEMP_DIR"
  echo

  if [ ! -f "$VOL2MESH_SURFACE" ]; then
    mirtk convert-pointset "$VOL2MESH_SURFACE_RH" "$VOL2MESH_SURFACE_LH" "$VOL2MESH_SURFACE"
  fi

  # select regions of interest
  n=$(get_number_of_rois)
  if [ $n -eq 0 ]; then
    CURRENT_DATABASE="$DATABASE"
    DATABASE="${CURRENT_DATABASE/.db/.next.db}"
    cp "$CURRENT_DATABASE" "$DATABASE"

    # extract cortical surface, discarding
    for hemi in 'right' 'left'; do
      if [ $hemi = 'right' ]; then
        surface_name="$WHITE_MATTER_SURFACE_RH"
        temp_surface_name="$TEMP_SURFACE_RH"
        reference1_name="$VOL2MESH_SURFACE_RH"
        reference2_name="$INITIAL_SURFACE_RH"
      else
        surface_name="$WHITE_MATTER_SURFACE_LH"
        temp_surface_name="$TEMP_SURFACE_LH"
        reference1_name="$VOL2MESH_SURFACE_LH"
        reference2_name="$INITIAL_SURFACE_LH"
      fi

      if [ -n "$temp_surface_name" ]; then
        mirtk erode-scalars "$surface_name" "$temp_surface_name" -cell-data CortexMask -iterations 2   || exit 1
        mirtk extract-pointset-cells "$temp_surface_name" "$temp_surface_name" -where CortexMask -gt 0 || exit 1
      fi

      for d in ${MIN_DISTANCE[@]}; do
        echo
        echo "Select regions of $hemi hemisphere with minimum distance = $d..."
        run "$SCRIPT_DIR/select-regions-of-interest.py" "$DATABASE" $VERBOSE_FLAGS \
              --subject "$SUBJECT" --session "$SESSION" \
              --surface "$temp_surface_name" --reference "$reference1_name" \
              --min-distance ${MIN_DISTANCE[0]} --min-patch-size 10 --min-patch-area 1 \
              --roi-size $ROI_SPAN --max-overlap $MAX_OVERLAP --max-scan-rois $MAX_SCAN_ROIS
        m=$(get_number_of_rois)
        if [ $n -eq $m ]; then
          break
        fi
        n=$m
        run "$SCRIPT_DIR/select-regions-of-interest.py" "$DATABASE" $VERBOSE_FLAGS \
              --subject "$SUBJECT" --session "$SESSION" \
              --surface "$temp_surface_name" --reference "$reference2_name" \
              --min-distance ${MIN_DISTANCE[0]} --min-patch-size 10 --min-patch-area 1 \
              --roi-size $ROI_SPAN --max-overlap $MAX_OVERLAP --max-scan-rois $MAX_SCAN_ROIS
        m=$(get_number_of_rois)
        if [ $n -eq $m ]; then
          break
        fi
        n=$m
      done

      #[ -z "$temp_surface_name" ] || rm -f "$temp_surface_name"
    done

    mv -f "$DATABASE" "$CURRENT_DATABASE" || exit 1
    DATABASE="$CURRENT_DATABASE"
    echo
    echo "Added $n regions of interest to database"
  else
    echo "Found $n regions of interest in database"
  fi

  # save screenshots of whole slices with bounding boxes overlaid
  n=$(get_number_of_screenshots_with_bounding_boxes)
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots-of-roi-bounds.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --prefix "$SCREENSHOTS_DIR/roi-bounds" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH
    n=$(get_number_of_screenshots_with_bounding_boxes)
    echo
    echo "Added $n screenshots with ROI bounding boxes to database"
  else
    echo "Found $n screenshots with ROI bounding boxes in database"
  fi

  # save screenshots with initial surface overlaid
  n=$(get_number_of_screenshots_with_initial_surface)
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --overlay $INITIAL_SURFACE_ID "$INITIAL_SURFACE" \
        --prefix "$SCREENSHOTS_DIR/roi-initial-surface" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH
    n=$(get_number_of_screenshots_with_initial_surface)
    echo
    echo "Added $n screenshots with initial surface overlaid to database"
  else
    echo "Found $n screenshots with initial surface overlaid in database"
  fi

  # save screenshots with white matter surface overlaid
  n=$(get_number_of_screenshots_with_white_matter_surface)
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --overlay $WHITE_MATTER_SURFACE_ID "$WHITE_MATTER_SURFACE" \
        --prefix "$SCREENSHOTS_DIR/roi-white-matter-surface" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH
    n=$(get_number_of_screenshots_with_white_matter_surface)
    echo
    echo "Added $n screenshots with white matter surface overlaid to database"
  else
    echo "Found $n screenshots with white matter surface overlaid in database"
  fi

  # save screenshots with vol2mesh surface overlaid
  n=$(get_number_of_screenshots_with_vol2mesh_surface)
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --overlay $VOL2MESH_SURFACE_ID "$VOL2MESH_SURFACE" \
        --prefix "$SCREENSHOTS_DIR/roi-vol2mesh-surface" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH
    n=$(get_number_of_screenshots_with_vol2mesh_surface)
    echo
    echo "Added $n screenshots with vol2mesh surface overlaid to database"
  else
    echo "Found $n screenshots with vol2mesh surface overlaid in database"
  fi

  # save screenshots with both initial and white matter surface overlaid
  n=$(get_number_of_screenshots_with_initial_and_white_matter_surface)
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --overlay $INITIAL_SURFACE_ID "$INITIAL_SURFACE" \
        --overlay $WHITE_MATTER_SURFACE_ID "$WHITE_MATTER_SURFACE" \
        --prefix "$SCREENSHOTS_DIR/roi-initial-and-white-matter-surface" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH \
        --shuffle-colors
    n=$(get_number_of_screenshots_with_initial_and_white_matter_surface)
    echo
    echo "Added $n screenshots with both initial and white matter surfaces overlaid to database"
  else
    echo "Found $n screenshots with both initial and white matter surfaces overlaid in database"
  fi

  # save screenshots with both vol2mesh and white matter surface overlaid
  n=$(get_number_of_screenshots_with_vol2mesh_and_white_matter_surface)
  n=0
  if [ $n -eq 0 ]; then
    run "$SCRIPT_DIR/take-screenshots.py" "$DATABASE" $VERBOSE_FLAGS \
        --subject "$SUBJECT" --session "$SESSION" --image "$IMAGE" \
        --overlay $WHITE_MATTER_SURFACE_ID "$WHITE_MATTER_SURFACE" \
        --overlay $VOL2MESH_SURFACE_ID "$VOL2MESH_SURFACE" \
        --prefix "$SCREENSHOTS_DIR/roi-vol2mesh-and-white-matter-surface" \
        --range $MIN_INTENSITY $MAX_INTENSITY \
        --subdiv $NUM_SUBDIVS --offsets ${ROI_OFFSETS[@]} \
        --line-width $LINE_WIDTH \
        --shuffle-colors
    n=$(get_number_of_screenshots_with_vol2mesh_and_white_matter_surface)
    echo
    echo "Added $n screenshots with both vol2mesh and white matter surfaces overlaid to database"
  else
    echo "Found $n screenshots with both vol2mesh and white matter surfaces overlaid in database"
  fi

done < "$SUBJECTS_CSV"
