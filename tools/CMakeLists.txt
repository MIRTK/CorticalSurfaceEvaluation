cmake_minimum_required(VERSION 3.0 FATAL_ERROR)

project(CorticalSurfaceEvaluationTools)

if (CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options("-Wno-inconsistent-missing-override")
endif ()

find_package(VTK REQUIRED COMPONENTS vtkCommonCore vtkCommonDataModel vtkIOXML vtkFiltersCore)

add_executable(select-rois select-rois.cc)
set_property(TARGET select-rois PROPERTY CXX_STANDARD 11)
target_include_directories(select-rois PRIVATE ${VTK_INCLUDE_DIRS})
target_link_libraries(select-rois ${VTK_LIBRARIES})

install(TARGETS select-rois RUNTIME DESTINATION bin)
