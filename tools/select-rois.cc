/**
 * \file  select-rois.cc
 * \brief Command line utility used to automatically determine points of interest.
 */

#include <iostream>
#include <limits>
#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>
#include <queue>
#include <string>
#include <sstream>
#include <cstdlib>
#include <ctime>
#include <unordered_set>

#include <vtkNew.h>
#include <vtkSmartPointer.h>
#include <vtkAppendPolyData.h>
#include <vtkMaskPoints.h>
#include <vtkXMLPolyDataReader.h>
#include <vtkXMLPolyDataWriter.h>
#include <vtkPolyData.h>
#include <vtkCellLocator.h>
#include <vtkPointLocator.h>
#include <vtkDataArray.h>
#include <vtkFloatArray.h>
#include <vtkIdTypeArray.h>
#include <vtkUnsignedCharArray.h>
#include <vtkGenericCell.h>
#include <vtkPointData.h>
#include <vtkCellData.h>
#include <vtkCellArray.h>

using namespace std;


// =============================================================================
// Help
// =============================================================================

// -----------------------------------------------------------------------------
void PrintHelp(const char *name)
{
  cout << "usage: " << name << " <surface> <reference> [options]\n";
  cout.flush();
}


// =============================================================================
// Globals
// =============================================================================

int g_verbose = 0;

// =============================================================================
// Auxiliaries
// =============================================================================

template <class T, class Alloc = std::allocator<T> >
using Array = std::vector<T, Alloc>;

template <class T>
using Queue = std::queue<T>;

template <class T>
using UnorderedSet = std::unordered_set<T>;


// -----------------------------------------------------------------------------
struct Cluster
{
  vtkIdType label;
  vtkIdType seed;
  vtkIdType size;
  float     center[3];
  float     total;

  Cluster() : label(-1), seed(-1), size(0), center{0.f, 0.f, 0.f}, total(0.f) {}

  bool operator <(const Cluster &rhs) const
  {
    return total < rhs.total;
  }
};


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkPolyData> Surface(const char *name)
{
  vtkNew<vtkXMLPolyDataReader> reader;
  reader->SetFileName(name);
  reader->UpdateWholeExtent();
  return reader->GetOutput();
}


// -----------------------------------------------------------------------------
bool Write(const char *name, vtkPolyData *mesh)
{
  vtkNew<vtkXMLPolyDataWriter> writer;
  writer->SetFileName(name);
  writer->SetInputData(mesh);
  return writer->Write() != 0;
}


// -----------------------------------------------------------------------------
template <typename T>
bool FromString(const char *str, T &value)
{
  if (str == nullptr || str[0] == '\0') return false;
  istringstream is(str);
  return !(is >> value).fail() && is.eof();
}


// -----------------------------------------------------------------------------
template <>
bool FromString(const char *str, bool &value)
{
  if (str == nullptr) return false;
  if (strcmp(str, "0") == 0 ||
      strcmp(str, "false") == 0 || strcmp(str, "False") == 0 || strcmp(str, "FALSE") == 0 ||
      strcmp(str, "no")    == 0 || strcmp(str, "No")    == 0 || strcmp(str, "NO")    == 0 ||
      strcmp(str, "off")   == 0 || strcmp(str, "Off")   == 0 || strcmp(str, "OFF")   == 0) {
    value = false;
    return true;
  }
  if (strcmp(str, "1") == 0 ||
      strcmp(str, "true") == 0 || strcmp(str, "True") == 0 || strcmp(str, "TRUE") == 0 ||
      strcmp(str, "yes")  == 0 || strcmp(str, "Yes")  == 0 || strcmp(str, "YES")  == 0 ||
      strcmp(str, "on")   == 0 || strcmp(str, "On")   == 0 || strcmp(str, "ON")   == 0) {
    value = true;
    return true;
  }
  return false;
}


// -----------------------------------------------------------------------------
void Print(vtkPolyData *surface, vtkPolyData *reference,
           const Array<Cluster> &clusters, const char *delim = ",")
{
  const vtkIdType offset = surface->GetNumberOfPoints();

  double p[3], q[3];
  vtkNew<vtkPointLocator> loc12, loc21;
  loc12->SetDataSet(reference);
  loc12->BuildLocator();
  loc21->SetDataSet(surface);
  loc21->BuildLocator();

  cout << "ClusterId,ClusterSize,AvgDistance,SeedId,SeedX,SeedY,SeedZ,CenterX,CenterY,CenterZ,MiddleX,MiddleY,MiddleZ\n";
  for (const auto &cluster : clusters) {
    if (cluster.seed >= offset) {
      reference->GetPoint(cluster.seed - offset, p);
      surface->GetPoint(loc21->FindClosestPoint(p), q);
    } else {
      surface->GetPoint(cluster.seed, p);
      reference->GetPoint(loc12->FindClosestPoint(p), q);
    }
    cout << cluster.label
         << delim << cluster.size
         << delim << (cluster.total / cluster.size)
         << delim << cluster.seed
         << delim << p[0] << delim << p[1] << delim << p[2]
         << delim << cluster.center[0]
         << delim << cluster.center[1]
         << delim << cluster.center[2]
         << delim << .5 * (p[0] + q[0])
         << delim << .5 * (p[1] + q[1])
         << delim << .5 * (p[2] + q[2])
         << "\n";
  }
  cout.flush();
}


// =============================================================================
// Point distances
// =============================================================================

// -----------------------------------------------------------------------------
vtkSmartPointer<vtkDataArray>
CellMaskToPointData(vtkPolyData *mesh, vtkSmartPointer<vtkDataArray> mask)
{
  unsigned short ncells;
  vtkIdType *cells;
  vtkSmartPointer<vtkDataArray> output;
  output.TakeReference(mask->NewInstance());
  output->SetName(mask->GetName());
  output->SetNumberOfComponents(1);
  output->SetNumberOfTuples(mesh->GetNumberOfPoints());
  for (vtkIdType ptId = 0; ptId < mesh->GetNumberOfPoints(); ++ptId) {
    mesh->GetPointCells(ptId, ncells, cells);
    output->SetComponent(ptId, 0, 0.);
    for (unsigned short i = 0; i < ncells; ++i) {
      if (mask->GetComponent(cells[i], 0) != 0.) {
        output->SetComponent(ptId, 0, 1.);
        break;
      }
    }
  }
  return output;
}


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkUnsignedCharArray>
ErodePointMask(vtkPolyData *mesh, vtkSmartPointer<vtkUnsignedCharArray> mask, int niter)
{
  vtkSmartPointer<vtkUnsignedCharArray> output = mask;
  if (mask && niter > 1) {
    unsigned short ncells;
    vtkIdType npts, *pts, *cells;
    vtkSmartPointer<vtkUnsignedCharArray> input = mask;
    output.TakeReference(mask->NewInstance());
    output->SetNumberOfComponents(1);
    output->SetNumberOfTuples(mask->GetNumberOfTuples());
    output->SetName(mask->GetName());
    for (int iter = 0; iter < niter; ++iter) {
      if (iter == 1) {
        input = output;
        output.TakeReference(input->NewInstance());
        output->SetNumberOfComponents(1);
        output->SetNumberOfTuples(input->GetNumberOfTuples());
        output->SetName(input->GetName());
      } else if (iter > 1) {
        vtkSmartPointer<vtkUnsignedCharArray> buffer = input;
        input  = output;
        output = buffer;
      }
      for (vtkIdType ptId = 0; ptId < mesh->GetNumberOfPoints(); ++ptId) {
        output->SetValue(ptId, 1);
        mesh->GetPointCells(ptId, ncells, cells);
        for (unsigned short i = 0; i < ncells; ++i) {
          mesh->GetCellPoints(cells[i], npts, pts);
          for (vtkIdType j = 0; j < npts; ++j) {
            if (input->GetValue(pts[j]) == 0) {
              output->SetValue(ptId, 0);
              i = ncells;
              break;
            }
          }
        }
      }
    }
  }
  return output;
}


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkUnsignedCharArray> PointMask(vtkPolyData *mesh, const char *name, int erode = 0)
{
  vtkSmartPointer<vtkDataArray> mask;
  if (name) {
    mask = mesh->GetPointData()->GetArray(name);
    if (mask == nullptr) {
      vtkSmartPointer<vtkDataArray> cmask = mesh->GetCellData()->GetArray(name);
      if (cmask) mask = CellMaskToPointData(mesh, cmask);
    }
    if (mask == nullptr) {
      cerr << "Input surface mesh has not point/cell data array named " << name << endl;
      exit(1);
    }
  }
  vtkSmartPointer<vtkUnsignedCharArray> output = vtkUnsignedCharArray::SafeDownCast(mask);
  if (output == nullptr) {
    output = vtkSmartPointer<vtkUnsignedCharArray>::New();
    output->DeepCopy(mask);
    output->CopyComponentNames(mask);
    output->SetName(mask->GetName());
  }
  return ErodePointMask(mesh, output, erode);
}


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkFloatArray>
PointToSurfaceDistances(vtkSmartPointer<vtkPolyData>  surface,
                        vtkSmartPointer<vtkPolyData>  reference,
                        vtkSmartPointer<vtkUnsignedCharArray> mask = nullptr)
{
  vtkSmartPointer<vtkFloatArray> dists;
  dists = vtkSmartPointer<vtkFloatArray>::New();
  dists->SetName("Distance");
  dists->SetNumberOfComponents(1);
  dists->SetNumberOfTuples(surface->GetNumberOfPoints());

  vtkNew<vtkCellLocator> locator;
  locator->SetDataSet(reference);
  locator->SetNumberOfCellsPerBucket(10);
  locator->BuildLocator();

  double p[3], q[3], dist2;
  vtkNew<vtkGenericCell> cell;
  vtkIdType cellId;
  int subId;

  for (vtkIdType ptId = 0; ptId < surface->GetNumberOfPoints(); ++ptId) {
    if (mask && mask->GetValue(ptId) == 0) {
      dists->SetValue(ptId, 0.f);
    } else {
      surface->GetPoint(ptId, p);
      locator->FindClosestPoint(p, q, cell.GetPointer(), cellId, subId, dist2);
      dists->SetValue(ptId, static_cast<float>(sqrt(dist2)));
    }
  }

  return dists;
}


// =============================================================================
// Clustering
// =============================================================================

// -----------------------------------------------------------------------------
struct CompareDistances
{
  vtkFloatArray * const dists;

  CompareDistances(vtkFloatArray *dists)
  :
    dists(dists)
  {}

  bool operator ()(vtkIdType i, vtkIdType j) const
  {
    return dists->GetValue(i) < dists->GetValue(j);
  }
};

// -----------------------------------------------------------------------------
Array<vtkIdType> InitSeeds(vtkSmartPointer<vtkFloatArray> dists)
{
  Array<vtkIdType> indices(static_cast<size_t>(dists->GetNumberOfTuples()));
  for (vtkIdType i = 0; i < dists->GetNumberOfTuples(); ++i) {
    indices[i] = i;
  }
  sort(indices.begin(), indices.end(), CompareDistances(dists));
  return indices;
}


// -----------------------------------------------------------------------------
vtkIdType NextSeed(Array<vtkIdType> &seeds, vtkFloatArray *dists, vtkIdTypeArray *labels, float threshold)
{
  while (!seeds.empty()) {
    const auto &seed = seeds.back();
    if (dists->GetValue(seed) < threshold) {
      seeds.clear();
      break;
    }
    if (labels->GetValue(seed) == -1) break;
    seeds.pop_back();
  }
  if (seeds.empty()) return -1;
  return seeds.back();
}


// -----------------------------------------------------------------------------
vtkIdType GrowCluster(vtkPolyData *mesh, vtkIdType seed,
                      vtkIdType label, float center[3], float &total,
                      vtkFloatArray *dists, vtkIdTypeArray *labels,
                      float threshold)
{
  double p[3];
  unsigned short ncells;
  vtkIdType ptId, npts, *pts, *cells, size = 0;
  Queue<vtkIdType> active;
  active.push(seed);
  center[0] = center[1] = center[2] = total = 0.f;
  while (!active.empty()) {
    ptId = active.front();
    active.pop();
    if (labels->GetValue(ptId) != label) {
      ++size;
      labels->SetValue(ptId, label);
      mesh->GetPoint(ptId, p);
      center[0] += static_cast<float>(p[0]);
      center[1] += static_cast<float>(p[1]);
      center[2] += static_cast<float>(p[2]);
      total += dists->GetValue(ptId);
      mesh->GetPointCells(ptId, ncells, cells);
      for (unsigned short i = 0; i < ncells; ++i) {
        mesh->GetCellPoints(cells[i], npts, pts);
        for (vtkIdType j = 0; j < npts; ++j) {
          if (labels->GetValue(pts[j]) == -1 && dists->GetValue(pts[j]) >= threshold) {
            active.push(pts[j]);
          }
        }
      }
    }
  }
  if (size > 0) {
    center[0] /= size;
    center[1] /= size;
    center[2] /= size;
  }
  return size;
}


// -----------------------------------------------------------------------------
void DiscardCluster(vtkIdTypeArray *labels, vtkIdType label)
{
  if (label != 0) {
    for (vtkIdType i = 0; i < labels->GetNumberOfTuples(); ++i) {
      if (labels->GetValue(i) == label) labels->SetValue(i, 0);
    }
  }
}


// -----------------------------------------------------------------------------
Array<Cluster> DistantClusters(vtkSmartPointer<vtkPolyData> surface,
                               vtkSmartPointer<vtkFloatArray> dists,
                               vtkSmartPointer<vtkIdTypeArray> labels,
                               vtkIdType min_size, float min_seed_dist,
                               float min_threshold, int dists_percentile = 0,
                               vtkIdType start_label = 1)
{
  Array<vtkIdType> seeds = InitSeeds(dists);

  if (g_verbose) {
    cerr << "Distance: ";
  }
  float threshold = 0.f;
  if (dists_percentile > 0) {
    const int n = static_cast<int>(dists->GetNumberOfTuples());
    float rank  = (static_cast<float>(dists_percentile) / 100.) * static_cast<float>(n + 1);
    int   k     = int(rank);

    if (k == 0) {
      threshold = numeric_limits<float>::infinity();
      for (vtkIdType ptId = 0; ptId < dists->GetNumberOfTuples(); ++ptId) {
        const auto dist = dists->GetValue(ptId);
        if (dist < threshold) threshold = dist;
      }
    } else if (k >= n) {
      for (vtkIdType ptId = 0; ptId < dists->GetNumberOfTuples(); ++ptId) {
        const auto dist = dists->GetValue(ptId);
        if (dist > threshold) threshold = dist;
      }
    } else {
      threshold = dists->GetValue(seeds[k - 1]) + (rank - k) * (dists->GetValue(seeds[k]) - dists->GetValue(seeds[k - 1]));
    }
    if (g_verbose) {
      cerr << dists_percentile << "%-tile value = " << threshold << ", ";
    }
  }
  if (threshold < min_threshold) {
    threshold = min_threshold;
  }
  if (min_seed_dist < threshold) {
    min_seed_dist = threshold;
  }
  if (g_verbose) {
    cerr << "min. seed distance = " << min_seed_dist << ", threshold = " << threshold << endl;
  }

  labels->SetNumberOfComponents(1);
  labels->SetNumberOfTuples(surface->GetNumberOfPoints());
  labels->FillComponent(0, -1.);

  Array<Cluster> clusters;
  Cluster cluster;
  cluster.label = start_label;
  while ((cluster.seed = NextSeed(seeds, dists, labels, min_seed_dist)) != -1) {
    cluster.size = GrowCluster(surface, cluster.seed, cluster.label, cluster.center, cluster.total, dists, labels, threshold);
    if (cluster.size < min_size) {
      DiscardCluster(labels, cluster.label);
    } else {
      clusters.push_back(move(cluster));
      ++cluster.label;
    }
  }

  return clusters;
}


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkPolyData>
FirstClusters(Array<Cluster> &clusters,
              vtkSmartPointer<vtkPolyData> surface,
              vtkSmartPointer<vtkPolyData> reference,
              vtkIdType min_size, float min_seed_dist,
              float min_threshold, int dists_percentile = 0,
              const char *mask_name = nullptr,
              int erode_mask = 0,
              vtkIdType start_label = 1)
{
  vtkSmartPointer<vtkUnsignedCharArray> mask = PointMask(surface, mask_name, erode_mask);
  vtkSmartPointer<vtkFloatArray> dists = PointToSurfaceDistances(surface, reference, mask);

  vtkSmartPointer<vtkIdTypeArray> labels;
  labels = vtkSmartPointer<vtkIdTypeArray>::New();
  labels->SetName("ClusterId");

  vtkPointData * const pd = surface->GetPointData();
  pd->AddArray(dists);
  pd->AddArray(labels);
  if (mask && !pd->HasArray(mask_name)) pd->AddArray(mask);

  clusters = DistantClusters(surface, dists, labels, min_size, min_seed_dist, min_threshold, dists_percentile, start_label);
  return surface;
}


// -----------------------------------------------------------------------------
vtkSmartPointer<vtkPolyData>
JointClusters(Array<Cluster> &clusters,
              vtkSmartPointer<vtkPolyData> surface1,
              vtkSmartPointer<vtkPolyData> surface2,
              vtkIdType min_size, float min_seed_dist,
              float min_threshold, int dists_percentile = 0,
              const char *mask_name = nullptr,
              int erode_mask = 0,
              vtkIdType start_label = 1)
{
  vtkSmartPointer<vtkUnsignedCharArray> mask1 = PointMask(surface1, mask_name, erode_mask);
  vtkSmartPointer<vtkUnsignedCharArray> mask2 = PointMask(surface2, mask_name, erode_mask);

  vtkSmartPointer<vtkFloatArray> dist12 = PointToSurfaceDistances(surface1, surface2, mask1);
  vtkSmartPointer<vtkFloatArray> dist21 = PointToSurfaceDistances(surface2, surface1, mask2);

  vtkSmartPointer<vtkPolyData> submesh1;
  submesh1 = vtkSmartPointer<vtkPolyData>::New();
  submesh1->ShallowCopy(surface1);
  submesh1->GetCellData()->Initialize();
  submesh1->GetPointData()->Initialize();
  submesh1->GetPointData()->AddArray(mask1);
  submesh1->GetPointData()->AddArray(dist12);

  vtkSmartPointer<vtkPolyData> submesh2;
  submesh2 = vtkSmartPointer<vtkPolyData>::New();
  submesh2->ShallowCopy(surface2);
  submesh2->GetCellData()->Initialize();
  submesh2->GetPointData()->Initialize();
  submesh2->GetPointData()->AddArray(mask2);
  submesh2->GetPointData()->AddArray(dist21);

  vtkNew<vtkAppendPolyData> appender;
  appender->AddInputData(submesh1);
  appender->AddInputData(submesh2);
  appender->Update();

  vtkSmartPointer<vtkPolyData> mesh = appender->GetOutput();
  mesh->BuildLinks();

  vtkSmartPointer<vtkFloatArray> dists;
  dists = vtkFloatArray::SafeDownCast(mesh->GetPointData()->GetArray("Distance"));

  if (mask_name != nullptr && mesh->GetPointData()->HasArray(mask_name) == 0) {
    cerr << "Output of vtkAppendPolyData is missing the " << mask_name << " point data array!" << endl;
    exit(1);
  }
  if (dists == nullptr) {
    cerr << "Output of vtkAppendPolyData is missing the Distance point data array!" << endl;
    exit(1);
  }

  vtkSmartPointer<vtkCellArray> lines;
  lines = vtkSmartPointer<vtkCellArray>::New();
  lines->Allocate(lines->EstimateSize(mesh->GetNumberOfPoints(), 2));
  mesh->SetLines(lines);

  vtkNew<vtkPointLocator> loc12;
  loc12->SetDataSet(submesh2);
  loc12->BuildLocator();

  vtkNew<vtkPointLocator> loc21;
  loc21->SetDataSet(submesh1);
  loc21->BuildLocator();

  double p[3];
  vtkIdType ptIds[2];
  const vtkIdType npts1 = submesh1->GetNumberOfPoints();
  for (ptIds[0] = 0; ptIds[0] < npts1; ++ptIds[0]) {
    mesh->GetPoint(ptIds[0], p);
    if (dists->GetValue(ptIds[0]) >= min_threshold) {
      ptIds[1] = loc12->FindClosestPoint(p) + npts1;
      lines->InsertNextCell(2, ptIds);
    }
  }
  for (; ptIds[0] < mesh->GetNumberOfPoints(); ++ptIds[0]) {
    mesh->GetPoint(ptIds[0], p);
    if (dists->GetValue(ptIds[0]) >= min_threshold) {
      ptIds[1] = loc21->FindClosestPoint(p);
      lines->InsertNextCell(2, ptIds);
    }
  }
  lines->Squeeze();

  vtkSmartPointer<vtkIdTypeArray> labels;
  labels = vtkSmartPointer<vtkIdTypeArray>::New();
  labels->SetName("ClusterId");
  mesh->GetPointData()->AddArray(labels);

  clusters = DistantClusters(mesh, dists, labels, min_size, min_seed_dist,
                             min_threshold, dists_percentile, start_label);
  return mesh;
}


// -----------------------------------------------------------------------------
void Relabel(Array<Cluster> &clusters, vtkIdTypeArray *labels)
{
  vtkNew<vtkIdTypeArray> old_labels;
  old_labels->DeepCopy(labels);
  vtkIdType new_label = 0;
  for (auto &&cluster : clusters) {
    const auto old_label = cluster.label;
    cluster.label = ++new_label;
    for (vtkIdType ptId = 0; ptId < labels->GetNumberOfTuples(); ++ptId) {
      if (old_labels->GetValue(ptId) == old_label) {
        labels->SetValue(ptId, new_label);
      }
    }
  }
}


// =============================================================================
// Sub-sampling
// =============================================================================

// -----------------------------------------------------------------------------
struct LineSweepEvent
{
  size_t index;
  float  coord;
  bool   enter;

  LineSweepEvent(size_t i, float x, bool enter)
  :
    index(i), coord(x), enter(enter)
  {}

  bool operator <(const LineSweepEvent &rhs) const
  {
    return coord < rhs.coord;
  }

  bool operator >(const LineSweepEvent &rhs) const
  {
    return coord > rhs.coord;
  }
};

typedef priority_queue<LineSweepEvent, Array<LineSweepEvent>, greater<LineSweepEvent> > LineSweepEvents;


// -----------------------------------------------------------------------------
void Bounds(float center[3], float span, float bounds[6])
{
  const float half_span = max(0.f, .5f * span);
  bounds[0] = center[0] - half_span;
  bounds[1] = center[0] + half_span;
  bounds[2] = center[1] - half_span;
  bounds[3] = center[1] + half_span;
  bounds[4] = center[2] - half_span;
  bounds[5] = center[2] + half_span;
}


// -----------------------------------------------------------------------------
void Insert(LineSweepEvents &events, const Array<Cluster> &clusters, size_t i,
            int dim, float span, float lbound, float ubound)
{
  if (span <= 0.f) return;
  const float half_span = .5f * span;
  float coord_min = clusters[i].center[dim] - half_span;
  float coord_max = clusters[i].center[dim] + half_span;
  if (!(coord_max < lbound || coord_min > ubound)) {
    coord_min = max(lbound, coord_min);
    coord_max = min(ubound, coord_max);
    if (coord_min < coord_max) {
      events.push(LineSweepEvent(i, coord_min, true ));
      events.push(LineSweepEvent(i, coord_max, false));
    }
  }
}


// -----------------------------------------------------------------------------
float Length(const Array<Cluster> &clusters, const UnorderedSet<size_t> &active, float span, float bounds[6])
{
  if (active.empty()) return 0.f;
  float l = 0.f;
  float t = 0.f;
  int   n = 0;
  LineSweepEvents events;
  for (auto i : active) {
    Insert(events, clusters, i, 0, span, bounds[0], bounds[1]);
  }
  while (!events.empty()) {
    const auto &event = events.top();
    if (n > 0) {
      l += (event.coord - t);
    }
    t = event.coord;
    n += (event.enter ? +1 : -1);
    events.pop();
  }
  return l;
}


// -----------------------------------------------------------------------------
float Area(const Array<Cluster> &clusters, const UnorderedSet<size_t> &active, float span, float bounds[6])
{
  if (active.empty()) return 0.f;
  float l = 0.f;
  float t = 0.f;
  float a = 0.f;
  LineSweepEvents events;
  UnorderedSet<size_t> intersected;
  for (auto i : active) {
    Insert(events, clusters, i, 1, span, bounds[2], bounds[3]);
  }
  while (!events.empty()) {
    const auto &event = events.top();
    if (l > 0.f) {
      a += (event.coord - t) * l;
    }
    if (event.enter) {
      intersected.insert(event.index);
    } else {
      intersected.erase(event.index);
    }
    t = event.coord;
    l = Length(clusters, intersected, span, bounds);
    events.pop();
  }
  return a;
}


// -----------------------------------------------------------------------------
float Volume(const Array<Cluster> &clusters, float span, float bounds[6])
{
  float a = 0.f;
  float v = 0.f;
  float t = 0.f;
  LineSweepEvents events;
  UnorderedSet<size_t> intersected;
  for (size_t i = 0; i < clusters.size(); ++i) {
    Insert(events, clusters, i, 2, span, bounds[4], bounds[5]);
  }
  while (!events.empty()) {
    const auto &event = events.top();
    if (a > 0.f) {
      v += (event.coord - t) * a;
    }
    if (event.enter) {
      intersected.insert(event.index);
    } else {
      intersected.erase(event.index);
    }
    t = event.coord;
    a = Area(clusters, intersected, span, bounds);
    events.pop();
  }
  return v;
}


// -----------------------------------------------------------------------------
float Volume(float bounds[6])
{
  return (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]) * (bounds[5] - bounds[4]);
}


// -----------------------------------------------------------------------------
float OverlapRatio(const Array<Cluster> &clusters, float span, float box[6])
{
  return Volume(clusters, span, box) / Volume(box);
}


// -----------------------------------------------------------------------------
Array<Cluster> ReduceClusters(const Array<Cluster> &clusters, float span, float max_overlap)
{
  float box[6];
  Array<Cluster> selection;
  for (auto cluster : clusters) {
    Bounds(cluster.center, span, box);
    if (OverlapRatio(selection, span, box) <= max_overlap) {
      selection.push_back(move(cluster));
    }
  }
  return selection;
}


// =============================================================================
// Random sampling
// =============================================================================

// -----------------------------------------------------------------------------
void AppendRandomSamples(Array<Cluster> &clusters, vtkPolyData *mesh, int n,
                         vtkFloatArray *dists = nullptr,
                         vtkUnsignedCharArray *mask = nullptr,
                         vtkIdType offset = 0, bool stratified = true,
                         float span = 0.f, float max_overlap = 1.f)
{
  double p[3];
  float roi[6];

  Cluster cluster;
  cluster.label = 0;
  cluster.size = 1;
  cluster.total = 0.f;

  vtkSmartPointer<vtkPolyData> samples;
  if (mask) {
    vtkSmartPointer<vtkPoints> points;
    points = vtkSmartPointer<vtkPoints>::New();
    points->Allocate(mesh->GetNumberOfPoints());
    for (vtkIdType ptId = 0; ptId < mesh->GetNumberOfPoints(); ++ptId) {
      mesh->GetPoint(ptId, p);
      if (mask->GetValue(ptId + offset) != 0) {
        points->InsertNextPoint(p);
      }
    }
    samples = vtkSmartPointer<vtkPolyData>::New();
    samples->SetPoints(points);
  } else {
    samples = mesh;
  }

  vtkNew<vtkMaskPoints> sampler;
  sampler->SetInputData(samples);
  sampler->RandomModeOn();
  sampler->SetMaximumNumberOfPoints(n);
  sampler->SetRandomModeType(stratified ? 2 : 1);

  vtkNew<vtkPointLocator> locator;
  locator->SetDataSet(mesh);
  locator->SetNumberOfPointsPerBucket(10);
  locator->BuildLocator();

  int m = 0;
  while (m < n) {
    sampler->Modified();
    sampler->Update();
    int k = 0;
    vtkPoints * const points = sampler->GetOutput()->GetPoints();
    for (vtkIdType ptId = 0; ptId < points->GetNumberOfPoints(); ++ptId) {
      points->GetPoint(ptId, p);
      cluster.center[0] = static_cast<float>(p[0]);
      cluster.center[1] = static_cast<float>(p[1]);
      cluster.center[2] = static_cast<float>(p[2]);
      if (dists) {
        cluster.total = dists->GetValue(ptId + offset);
      }
      if (span > 0.f && max_overlap < 1.f) {
        Bounds(cluster.center, span, roi);
        if (OverlapRatio(clusters, span, roi) > max_overlap) {
          continue;
        }
      }
      cluster.seed = locator->FindClosestPoint(p) + offset;
      clusters.push_back(cluster);
      ++k;
      if (m + k >= n) break;
    }
    if (k == 0) {
      max_overlap *= 1.2f;
    } else {
      m += k;
    }
  }
}


// =============================================================================
// Main
// =============================================================================

// -----------------------------------------------------------------------------
int main(int argc, char *argv[])
{
  // Initialize random number generator
  srand(time(0));

  // Parse command arguments
  if (argc < 3) {
    PrintHelp(argv[0]);
    exit(1);
  }

  const char *surface_name   = argv[1];
  const char *reference_name = argv[2];

  const char *delim            = nullptr;
  const char *output_name      = nullptr;
  const char *pset_name        = nullptr;
  const char *mask_name        = nullptr;
  int         erode_mask       = 0;
  int         dist_percentile  = 0;
  float       min_seed_dist    = 2.f;
  float       min_threshold    = -1.f;
  float       roi_span         = 40.f;
  int         max_points       = 0;
  int         num_points       = 0;
  float       random_ratio     = 0.f;
  float       max_overlap      = 1.f;
  vtkIdType   min_size         = 10;
  bool        jointly          = false;
  bool        centered         = false;
  bool        midpoints        = false;
  bool        stratified       = false;

  for (int i = 3; i < argc; ++i) {
    string opt = argv[i];
    if (opt[0] != '-') {
      cerr << "Too many positional arguments given!" << endl;
      exit(1);
    }
    else if (opt == "-mask-name" || opt == "-mask") {
      mask_name = argv[++i];
      if (!mask_name) {
        cerr << "Option " << opt << " requires an argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-mask-erosion") {
      if (!FromString(argv[++i], erode_mask) || erode_mask < 0) {
        cerr << "Option " << opt << " requires a non-negative integral number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-min-seed-distance" || opt == "-min-distance") {
      if (!FromString(argv[++i], min_seed_dist)) {
        cerr << "Option " << opt << " requires a floating point number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-min-distance-threshold" || opt == "-distance-threshold") {
      if (!FromString(argv[++i], min_threshold)) {
        cerr << "Option " << opt << " requires a floating point number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-distance-threshold-percentile") {
      if (!FromString(argv[++i], dist_percentile) || dist_percentile < 0 || dist_percentile > 100) {
        cerr << "Option " << opt << " requires an integral number in [0, 100] as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-min-cluster-size") {
      if (!FromString(argv[++i], min_size) || min_size < 0) {
        cerr << "Option " << opt << " requires a non-negative integral number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-joined-clustering") {
      if (!FromString(argv[++i], jointly)) {
        cerr << "Option " << opt << " requires a boolean argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-cluster-centers") {
      if (!FromString(argv[++i], centered)) {
        cerr << "Option " << opt << " requires a boolean argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-link-centers") {
      if (!FromString(argv[++i], midpoints)) {
        cerr << "Option " << opt << " requires a boolean argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-stratified") {
      if (!FromString(argv[++i], stratified)) {
        cerr << "Option " << opt << " requires a boolean argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-span") {
      if (!FromString(argv[++i], roi_span) || roi_span <= 0.f) {
        cerr << "Option " << opt << " requires a positive number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-srand") {
      unsigned int seed;
      if (!FromString(argv[++i], seed)) {
        cerr << "Option " << opt << " requires a non-negative integral number as argument!" << endl;
        exit(1);
      }
      srand(seed);
    }
    else if (opt == "-max-overlap-ratio") {
      if (!FromString(argv[++i], max_overlap) || max_overlap < 0.f || max_overlap > 1.f) {
        cerr << "Option " << opt << " requires a number in [0, 1] as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-max-points") {
      if (!FromString(argv[++i], max_points) || max_points < 0) {
        cerr << "Option " << opt << " requires a non-negative integral number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-num-points") {
      if (!FromString(argv[++i], num_points) || num_points < 0) {
        cerr << "Option " << opt << " requires a non-negative integral number as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-random-points-ratio") {
      if (!FromString(argv[++i], random_ratio) || random_ratio < 0.f || random_ratio > 1.f) {
        cerr << "Option " << opt << " requires a floating point number in [0, 1] as argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-delim" || opt == "-delimiter" || opt == "-sep" || opt == "-seperator") {
      delim = argv[++i];
      if (!delim) {
        cerr << "Option " << opt << " requires an argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-output-points") {
      pset_name = argv[++i];
      if (!pset_name) {
        cerr << "Option " << opt << " requires an argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-output-surface") {
      output_name = argv[++i];
      if (!output_name) {
        cerr << "Option " << opt << " requires an argument!" << endl;
        exit(1);
      }
    }
    else if (opt == "-v" || opt == "-verbose") {
      ++g_verbose;
    }
    else {
      cerr << "Unknown option: " << opt << endl;
      exit(1);
    }
  }
  if (delim == nullptr && pset_name == nullptr && output_name == nullptr) {
    delim = ",";
  }
  if (min_threshold < 0.f) {
    if (dist_percentile > 0) {
      min_threshold = .1f * min_seed_dist;
    } else {
      min_threshold = .5f * min_seed_dist;
    }
  }
  if (num_points > 0) {
    max_points = num_points;
  }
  if (centered && midpoints) {
    cerr << "Options -cluster-centers and -link-centers are mutually exclusive!" << endl;
    exit(1);
  }

  // Read input surfaces
  vtkSmartPointer<vtkPolyData> surface   = Surface(surface_name);
  vtkSmartPointer<vtkPolyData> reference = Surface(reference_name);

  surface  ->BuildLinks();
  reference->BuildLinks();

  // Compute clusters of (mutually) distant points
  vtkSmartPointer<vtkPolyData> output;
  Array<Cluster> clusters;
  if (jointly) {
    output = JointClusters(clusters, surface, reference, min_size, min_seed_dist,
                           min_threshold, dist_percentile, mask_name, erode_mask);
  } else {
    output = FirstClusters(clusters, surface, reference, min_size, min_seed_dist,
                           min_threshold, dist_percentile, mask_name, erode_mask);
  }

  // Sort clusters by size
  sort(clusters.rbegin(), clusters.rend());
  vtkIdTypeArray *labels = vtkIdTypeArray::SafeDownCast(output->GetPointData()->GetArray("ClusterId"));
  vtkUnsignedCharArray *mask = nullptr;
  if (mask_name) {
    mask = vtkUnsignedCharArray::SafeDownCast(output->GetPointData()->GetArray(mask_name));
  }
  vtkFloatArray *dists = vtkFloatArray::SafeDownCast(output->GetPointData()->GetArray("Distance"));

  // Reduce number of clusters
  if (max_overlap < 1.f) {
    clusters = ReduceClusters(clusters, roi_span, max_overlap);
  }
  if (g_verbose) {
    cerr << "Selected " << clusters.size() << " distant clusters" << endl;
  }

  // Truncate number of clusters
  if (max_points > 0) {
    const size_t n = static_cast<size_t>(max_points);
    if (clusters.size() > n) {
      for (size_t i = n; i < clusters.size(); ++i) {
        DiscardCluster(labels, clusters[i].label);
      }
      clusters.resize(n);
    }
  }

  // Ensure that a certain ratio of points is randomly selected
  if (random_ratio > 0.f) {
    int k = (max_points > 0 ? max_points : static_cast<int>(clusters.size()));
    int n = static_cast<int>(round(random_ratio * k));
    if (max_points > 0) {
      size_t m = static_cast<size_t>(max(0, max_points - n));
      if (clusters.size() > m) {
        for (size_t i = m; i < clusters.size(); ++i) {
          DiscardCluster(labels, clusters[i].label);
        }
        clusters.resize(m);
      }
    }
    const vtkIdType offset = 0;
    AppendRandomSamples(clusters, surface, n, dists, mask, offset, stratified, roi_span, max_overlap);
    if (g_verbose) {
      cerr << "Appended " << n << " random clusters" << endl;
    }
  }
  if (num_points > 0) {
    int n = num_points - static_cast<int>(clusters.size());
    if (n > 0) {
      const vtkIdType offset = 0;
      AppendRandomSamples(clusters, surface, n, dists, mask, offset, stratified, roi_span, max_overlap);
      if (g_verbose) {
        cerr << "Appended " << n << " random clusters" << endl;
      }
    }
  }

  // Relabel clusters such that label is increasing cluster ID
  Relabel(clusters, labels);

  // Print selected clusters
  if (delim != nullptr) {
    Print(surface, reference, clusters, delim);
  }

  // Write surface mesh with computed point data
  if (output_name) {
    if (!Write(output_name, output)) {
      cerr << "Failed to write -output-surface to " << output_name << endl;
      exit(1);
    }
  }

  // Write selected cluster points
  if (pset_name) {
    vtkSmartPointer<vtkPoints> points = vtkSmartPointer<vtkPoints>::New();
    points->SetNumberOfPoints(static_cast<vtkIdType>(clusters.size()));
    if (centered) {
      for (vtkIdType i = 0; i < points->GetNumberOfPoints(); ++i) {
        points->SetPoint(i, clusters[i].center);
      }
    } else if (midpoints) {
      double p[3], q[3];
      vtkNew<vtkPointLocator> loc12, loc21;
      loc12->SetDataSet(reference);
      loc12->BuildLocator();
      loc21->SetDataSet(surface);
      loc21->BuildLocator();
      vtkIdType offset = surface->GetNumberOfPoints();
      for (vtkIdType i = 0; i < points->GetNumberOfPoints(); ++i) {
        output->GetPoint(clusters[i].seed, p);
        if (clusters[i].seed >= offset) {
          surface->GetPoint(loc21->FindClosestPoint(p), q);
        } else {
          reference->GetPoint(loc12->FindClosestPoint(p), q);
        }
        points->SetPoint(i, .5 * (p[0] + q[0]), .5 * (p[1] + q[1]), .5 * (p[2] + q[2]));
      }
    } else {
      for (vtkIdType i = 0; i < points->GetNumberOfPoints(); ++i) {
        points->SetPoint(i, output->GetPoint(clusters[i].seed));
      }
    }
    vtkSmartPointer<vtkPolyData> pset = vtkSmartPointer<vtkPolyData>::New();
    pset->SetPoints(points);
    if (!Write(pset_name, pset)) {
      cerr << "Failed to write -output-points to " << pset_name << endl;
      exit(1);
    }
  }

  return 0;
}