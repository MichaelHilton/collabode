import("helpers");
import("utils.*");

import("collab.collab_server");

import("editor.workspace");

import("pad.model");
import("pad.revisions");

jimport("org.eclipse.core.resources.IMarker");
jimport("org.eclipse.core.resources.IResource");

jimport("java.lang.System");

function render_root() {
  renderHtml("editor/root.ejs", {
    projects: workspace.listProjects()
  });
  return true;
}

function render_project(projectname) {
  var project = workspace.accessProject(projectname);
  
  if ( ! project.exists()) {
    renderHtml("editor/project_create.ejs", {
      project: project,
      projects: workspace.listProjects()
    });
    return true;
  }    
  
  var projectfiles = workspace.listProjects().slice();
  projectfiles.splice(projectfiles.indexOf(project)+1, 0, project.members());
  
  renderHtml("editor/project.ejs", {
    project: project,
    projectfiles: projectfiles,
    markers: _find_markers(project)
  });
  return true;
}

function create_project(projectname) {
  var project = workspace.createProject(projectname);
  response.redirect(request.url);
  return true;
}

function render_path(projectname, filename) {
  var project = workspace.accessProject(projectname);
  var resource = project.findMember(filename);
  
  var projectfiles = workspace.listProjects().slice();
  
  if (resource == null) {
    renderHtml("editor/none.ejs", {
      project: project,
      filename: filename,
      projectfiles: projectfiles
    });
    
    return true;
  }
  
  function tree(resource) {
    var members = resource.members();
    var idx;
    while ((idx = projectfiles.indexOf(resource)) < 0) {
      members = [ resource, members ];
      resource = resource.getParent();
    }
    projectfiles.splice(idx+1, 0, members);
    return projectfiles;
  }
  
  switch(resource.getType()) {
  
  case IResource.FILE:
    return _render_file(project, resource, tree(resource.getParent()));
  
  case IResource.FOLDER:    
    renderHtml("editor/folder.ejs", {
      project: project,
      folder: resource,
      projectfiles: tree(resource),
      markers: _find_markers(resource)
    });
    return true;
  }
}

function _find_markers(resource) {
  function name(severity) {
    switch (severity) {
    case IMarker.SEVERITY_INFO: return 'info';
    case IMarker.SEVERITY_WARNING: return 'warning';
    case IMarker.SEVERITY_ERROR: return 'error';
    }
    return 'note';
  }
  function objectify(m) {
    return {
      id: m.getId(),
      severity: m.getAttribute(IMarker.SEVERITY, -1),
      severityName: name(m.getAttribute(IMarker.SEVERITY)),
      message: m.getAttribute(IMarker.MESSAGE),
      resource: m.getResource(),
      lineNumber: m.getAttribute(IMarker.LINE_NUMBER, 0),
      equals: function() { return false; },
      getClass: function() { return { getSimpleName: function() { return 'marker' } }; }
    };
  }
  function compare(m1, m2) {
    var result = 0;
    [
      function() { return m2.severity - m1.severity; },
      function() { return m1.resource.getFullPath().toString().localeCompare(m2.resource.getFullPath().toString()); },
      function() { return m1.lineNumber - m2.lineNumber; },
      function() { return m1.id - m2.id; }
    ].forEach(function(f) {
      if (result == 0) { result = f(); }
    });
    return result;
  }
  
  var markers = resource.findMarkers(null, true, IResource.DEPTH_INFINITE).map(objectify);
  markers.sort(compare);
  return markers;
}

function _render_file(project, file, projectfiles) {
  var padId = workspace.accessDocumentPad(workspace.everyone, file);
  
  model.accessPadGlobal(padId, function(pad) {
    helpers.addClientVars({
      padId: padId,
      collab_client_vars: collab_server.getCollabClientVars(pad),
      initialRevisionList: revisions.getRevisionList(pad),
      serverTimestamp: +(new Date),
      initialOptions: pad.getPadOptionsObj(),
      userId: getSession().userId,
      userName: getSession().userName,
      opts: {}
    });
  });
  
  var filetype = workspace.getContentTypeName(padId);
  var additions = renderFirstTemplateAsString([ "editor/file/" + camelToUnderscore(filetype) + ".ejs" ], {
    project: project,
    file: file
  });
  renderHtml("editor/file.ejs", {
    project: project,
    file: file,
    projectfiles: projectfiles,
    filetype: filetype,
    additions: additions
  });
  return true;
}

function render_confirm_delete(projectname, filename) {
  var project = workspace.accessProject(projectname);
  var resource = project.findMember(filename);
  
  renderHtml("editor/path_delete.ejs", {
    project: project,
    projects: workspace.listProjects(),
    resource: resource
  });
  return true;
}

function create_path(projectname, filename) {
  var project = workspace.accessProject(projectname);
  var folder = project.findMember(filename);
  
  if (folder.getType() != IResource.FOLDER) {
    return true;
  }
  
  var foldername = request.params["foldername"];
  var filename = request.params["filename"];
  
  if ((request.params["folder"] || ! filename.length) && foldername.length) {
    _create_path_folder(project, folder, foldername);
  }
  
  if ((request.params["file"] || ! foldername.length) && filename.length) {
    _create_path_file(project, folder, filename);
  }
  
  response.redirect(request.url);
  return true;
}

function _create_path_folder(project, parent, foldername) {
  System.err.println("_create_path_folder(" + project + ", " + parent + ", " + foldername + ")");
  var folder = parent.getFolder(foldername);
  if (folder.exists()) {
    return true;
  }
  
  folder.create(false, true, null);
}

function _create_path_file(project, parent, filename) {
  System.err.println("_create_path_file(" + project + ", " + parent + ", " + filename + ")");
  var file = parent.getFile(filename);
  if (file.exists()) {
    return true;
  }
  
  file.create(new java.io.InputStream({ read: function() { return -1; }}), false, null);
}

function delete_path(projectname, filename) {
  var project = workspace.accessProject(projectname);
  var resource = project.findMember(filename);
  var parentpath = ''+resource.getParent().getFullPath();
  
  resource['delete'](false, null); // workaround because `delete` is a JS keyword
  
  response.redirect(parentpath);
  return true;
}