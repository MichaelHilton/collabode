import("jsutils.scalaFn");

import("collab.ace.easysync2.{AttribPool,Changeset}");
import("collab.collab_server");

import("pad.model");

jimport("collabode.PadFunctions");
jimport("collabode.PadDocumentOwner");
jimport("collabode.Workspace");
jimport("collabode.running.FileRunOwner");
jimport("collabode.testing.ProjectTestsOwner");

jimport("java.lang.System");

function onStartup() {
  PadFunctions.bind(scalaFn(3, _pdsyncPadText),
                    scalaFn(3, _reportPadProblems),
                    scalaFn(3, _reportTestResult));
  collab_server.setExtendedHandler("RUN_REQUEST", _onRunRequest);
  collab_server.setExtendedHandler("TESTS_REQUEST", _onTestsRequest);
}

function listProjects() {
  return Workspace.listProjects();
}

function accessProject(projectname) {
  return Workspace.accessProject(projectname);
}

function createProject(projectname) {
  return Workspace.createProject(projectname);
}

function _padIdFor(username, file) {
  return username + "@" + file.getFullPath();
}

function _pdsyncPadText(username, file, txt) { // XXX should take revisions, not full text
  model.accessPadGlobal(_padIdFor(username, file), function(pad) {
    pad.pdsync(function() {
      collab_server.setPadText(pad, txt);
    });
  });
}

function _reportPadProblems(username, file, problems) {
  model.accessPadGlobal(_padIdFor(username, file), function(pad) {
    collab_server.updatePadClientsAnnotations(pad, "problem", problems.map(function(problem) {
      return {
        lineNumber: problem.getSourceLineNumber(),
        severity: (problem.isError() ? "error" : "warning"),
        message: problem.getMessage()
      };
    }));
  });
}

const everyone = "pool.everyone";

function accessDocumentPad(username, file) {
  var padId = _padIdFor(username, file);
  
  model.accessPadGlobal(padId, function(pad) {
    if ( ! pad.exists()) {
      pad.create(true);
    }
  });
  
  Workspace.createDocument(username, file);
  
  return padId;
}

function _getDocument(padId) {
  var username_filename = padId.split("@", 2);
  return PadDocumentOwner.of(username_filename[0]).get(username_filename[1]);
}

function taskPdsyncDocumentText(padId, cs) {
  var doc = _getDocument(padId);
  
  var unpacked = Changeset.unpack(cs);
  var csIter = Changeset.opIterator(unpacked.ops);
  var bankIter = Changeset.stringIterator(unpacked.charBank);
  var ops = [];
  
  // combine consecutive |LxN and xN ops since we don't care about L,
  // and combine -'s followed by +'s into a single replacement
  var last = null;
  while (csIter.hasNext()) {
    var op = csIter.next();
    if (last == op.opcode) {
      ops[ops.length-1].chars += op.chars;
    } else if ((last == '-') && (op.opcode == '+')) {
      var del = ops.pop();
      ops.push({ opcode: 'r', delchars: del.chars, inschars: op.chars });
      last = 'r';
    } else if ((last == 'r') && (op.opcode == '+')) {
      ops[ops.length-1].inschars += op.chars;
    } else {
      ops.push({ opcode: op.opcode, chars: op.chars });
      last = op.opcode;
    }
  }
  
  var pos = 0;
  ops.forEach(function(op) {
    switch (op.opcode) {
    case 'r':
      doc.pdsyncReplace(pos, op.delchars, bankIter.take(op.inschars));
      pos += op.inschars - op.delchars;
      break;
    case '+':
      doc.pdsyncReplace(pos, 0, bankIter.take(op.chars));
      pos += op.chars;
      break;
    case '-':
      doc.pdsyncReplace(pos, op.chars, "");
      break;
    case '=':
      pos += op.chars;
      break;
    }
  });
}

function taskPdsyncPadStyle(username, file, iterator) {
  model.accessPadGlobal(_padIdFor(username, file), function(pad) {
    var apool = pad.pool();
    var builder = Changeset.builder(pad.text().length); // XXX ignoring len
    while (iterator.hasNext()) {
      var op = iterator.next();
      builder.keep(op.chars, op.lines, op.attribs.map(function(a) { return a.slice(); }), apool);
    }
    var changeset = builder.toString();
    pad.pdsync(function () {
      collab_server.applyChangesetToPad(pad, changeset, "#syntaxcolor");
    });
  });
}

function onNewEditor(padId, connectionId) {
}

function _onTestsRequest(padId, connectionId, msg) {
  switch (msg.action) {
  case 'state':
    var doc = _getDocument(padId);
    ProjectTestsOwner.of(doc.getProject()).reportResults(scalaFn(2, function(test, result) {
      collab_server.updateClientTestResult(connectionId, test, result); // XXX change to extended req
    }));
    break;
  }
}

function codeComplete(padId, offset, connectionId) {
  _getDocument(padId).codeComplete(offset, scalaFn(1, function(proposals) {
    collab_server.updateClientCodeCompletionProposals(connectionId, padId, offset, proposals.map(function(proposal) {
      return {
        completion: "" + proposal.displayString,
        replacement: "" + proposal.replacementString,
        length: proposal.replacementLength,
        offset: proposal.replacementOffset
      };
    }));
  }));
}

function getContentTypeName(padId) {
  return _getDocument(padId).getContentTypeName();
}

function _reportTestResult(project, test, result) {
  collab_server.updateProjectClientsTestResult("" + project.getName(), test, result);
}

function _runningPadIdFor(username, file) {
  return username + "*run*" + file.getFullPath();
}

function _runningUserFileFor(padId) {
  var uf = padId.split("*run*", 2);
  return { username: uf[0], filename: uf[1] };
}

function accessRunFilePad(username, file) {
  var padId = _runningPadIdFor(username, file);
  
  model.accessPadGlobal(padId, function(pad) {
    if ( ! pad.exists()) {
      pad.create(false);
    }
  });
  
  return padId;
}

function _onRunRequest(padId, connectionId, msg) {
  var uf = _runningUserFileFor(padId);
  var owner = FileRunOwner.of(uf.username);
  
  switch (msg.action) {
  case 'state':
    collab_server.sendConnectionExtendedMessage(connectionId, {
      type: "RUN_STATE_CHANGE",
      state: owner.state(uf.filename)
    });
    break;
  case 'launch':
    owner.run(uf.filename);
    break;
  case 'terminate':
    owner.stop(uf.filename);
    break;
  }
}

function taskRunningStateChange(username, file, state) {
  var gray = [ [ 'foreground', '150,150,150' ] ];
  model.accessPadGlobal(_runningPadIdFor(username, file), function(pad) {
    switch(state) {
    case 'launching':
      collab_server.setPadText(pad, "");
      collab_server.appendPadText(pad, " [ Started " + new Date() + " ]\n", gray);
      break;
    case 'terminated':
      collab_server.appendPadText(pad, " [ Stopped " + new Date() + " ]\n", gray);
      break;
    }
    collab_server.sendPadExtendedMessage(pad, { type: "RUN_STATE_CHANGE", state: state });
  });
}

function taskRunningOutput(username, file, text, attribs) {
  model.accessPadGlobal(_runningPadIdFor(username, file), function(pad) {
    collab_server.appendPadText(pad, text, attribs.map(function(a) { return a.slice(); }));
  });
}