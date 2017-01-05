cmake_minimum_required(VERSION 3.0 FATAL_ERROR)

project(CorticalSurfaceEvaluationTools)

if (CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options("-Wno-inconsistent-missing-override")
endif ()

find_package(MIRTK REQUIRED COMPONENTS CMake Image IO)
find_package(TBB REQUIRED COMPONENTS tbb)
find_package(VTK REQUIRED COMPONENTS vtkCommonCore vtkCommonDataModel vtkIOXML vtkFiltersCore vtkFiltersExtraction vtkFiltersGeometry)

include(${MIRTK_USE_FILE})

add_executable(select-rois select-rois.cc)
set_property(TARGET select-rois PROPERTY CXX_STANDARD 11)
target_include_directories(select-rois PRIVATE ${VTK_INCLUDE_DIRS} ${MIRTK_INCLUDE_DIRS})
target_link_libraries(select-rois ${VTK_LIBRARIES} mirtk::LibNumerics mirtk::LibImage mirtk::LibIO)

set_target_properties(select-rois PROPERTIES INSTALL_RPATH "${MIRTK_LIBRARY_DIR}")
install(TARGETS select-rois RUNTIME DESTINATION bin)
