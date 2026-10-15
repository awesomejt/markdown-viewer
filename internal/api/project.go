package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net/http"
	"path"
	"sync"
	"sync/atomic"

	"github.com/awesomejt/markdown-viewer/internal/fsroot"
	"github.com/awesomejt/markdown-viewer/internal/settings"
)

// codeProjectInvalid is the 422 error code for a project file that cannot be
// used as a project.
const codeProjectInvalid = "project_invalid"

type projectOpenJSON struct {
	Root string `json:"root"`
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type projectEntryJSON struct {
	Root string `json:"root"`
	Path string `json:"path"`
	Type string `json:"type"`
	Kind string `json:"kind"`
	Ref  string `json:"ref"`
	Line int    `json:"line"`
}

type projectJSON struct {
	Root     string             `json:"root"`
	Path     string             `json:"path"`
	Name     *string            `json:"name"`
	Open     *projectOpenJSON   `json:"open"`
	Entries  []projectEntryJSON `json:"entries"`
	Settings settings.Settings  `json:"settings"`
	Warnings []settings.Warning `json:"warnings"`
}

func (s *Server) project(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	h, rootName, ok := s.handleFor(w, r)
	if !ok {
		return
	}
	rel := r.URL.Query().Get("path")
	if rel == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "missing path parameter")
		return
	}
	if fsroot.ClassifyName(rel) != fsroot.FileKindProject {
		writeError(w, http.StatusBadRequest, codeBadRequest, "path is not a project file (*.mdv.yaml or *.mdv.yml)")
		return
	}
	name, err := fsroot.Resolve(rel)
	if err != nil {
		s.fsError(w, r, err)
		return
	}
	ctx := r.Context()
	b, ok := s.readProject(w, r, h, rel)
	if !ok {
		return
	}
	release, err := s.parseSem.Acquire(ctx)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, codeBusy, "server busy, retry shortly")
		return
	}
	proj, warns, err := settings.ParseProject(b)
	release()
	var pe *settings.ParseError
	if errors.As(err, &pe) {
		s.logger.DebugContext(ctx, "project parse failed", "root", rootName, "path", rel, "line", pe.Line, "code", codeProjectInvalid)
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: errorDetail{
			Code: codeProjectInvalid, Message: pe.Msg, Line: pe.Line}})
		return
	}
	if err != nil { // ParseProject only returns *ParseError; stay safe
		s.logger.DebugContext(ctx, "project parse failed", "root", rootName, "path", rel, "code", codeProjectInvalid)
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: errorDetail{
			Code: codeProjectInvalid, Message: "could not parse the file"}})
		return
	}
	dir := path.Dir(name)
	if dir == "." {
		dir = ""
	}
	out, err := s.resolveProject(ctx, h, rootName, name, dir, sha256.Sum256(b), proj, warns)
	if err != nil { // the client went away while the shared stat phase ran
		if ctx.Err() != nil {
			s.logger.DebugContext(ctx, "project request canceled", "root", rootName, "path", rel)
			return
		}
		s.fsError(w, r, &fsroot.PathError{Kind: fsroot.KindTimeout, Op: "stat", Path: rel, Reason: "request canceled", Err: err})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// readProject reads the project file under the size cap. On failure it has
// answered and returns false.
func (s *Server) readProject(w http.ResponseWriter, r *http.Request, h *fsroot.Handle, rel string) ([]byte, bool) {
	ctx := r.Context()
	f, err := h.Open(ctx, rel)
	if err != nil {
		s.fsError(w, r, err)
		return nil, false
	}
	defer func() { _ = f.Close() }()
	fi, err := h.FileStat(ctx, f)
	if err != nil {
		s.fsError(w, r, err)
		return nil, false
	}
	if fi.IsDir() {
		writeError(w, http.StatusBadRequest, codeBadRequest, "path is a directory")
		return nil, false
	}
	if fi.Size() > settings.MaxFileSize {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: errorDetail{
			Code: codeProjectInvalid, Message: "project file is larger than 32 KiB"}})
		return nil, false
	}
	b, err := io.ReadAll(h.Reader(ctx, f, fi.Size()))
	if err != nil {
		s.fsError(w, r, err)
		return nil, false
	}
	return b, true
}

// resolveProject turns the parsed references into entries and warnings.
func (s *Server) resolveProject(ctx context.Context, h *fsroot.Handle, root, projPath, dir string,
	sum [32]byte, proj *settings.Project, warns []settings.Warning) (*projectJSON, error) {
	// Drop the parser's own truncation marker; the combined list is capped at the end.
	parserTruncated := false
	if n := len(warns); n > 0 && warns[n-1].Code == settings.CodeWarningsTruncated {
		warns = warns[:n-1]
		parserTruncated = true
	}
	warn := func(code, reason string, ref settings.Ref) {
		warns = append(warns, settings.NewWarning(code, refMessage(code, ref.Text, reason), ref.Key, ref.Text, ref.Line))
	}

	var (
		openRes  refResult
		paths    []string
		seen     = map[string]bool{}
		wantStat = func(p string) {
			if !seen[p] {
				seen[p] = true
				paths = append(paths, p)
			}
		}
		includes []refResult
		included = map[string]bool{}
		hasOpen  = proj.Open != nil
	)
	if hasOpen {
		if openRes = resolveRef(dir, proj.Open.Text); openRes.code != "" {
			warn(openRes.code, openRes.reason, *proj.Open)
			hasOpen = false
		} else {
			wantStat(openRes.path)
		}
	}
	for _, ref := range proj.Include {
		res := resolveRef(dir, ref.Text)
		if res.code == "" {
			if included[res.path] { // silent de-duplication, first wins
				res.dup = true
			} else {
				included[res.path] = true
				wantStat(res.path)
			}
		}
		includes = append(includes, res)
	}

	stats, err := s.flight.do(ctx, flightKey{root: root, path: projPath, sum: sum},
		func(c context.Context) map[string]statRes { return s.statPaths(c, h, paths) })
	if err != nil {
		return nil, err
	}
	statOf := func(p string) statRes {
		if st, ok := stats[p]; ok {
			return st
		}
		return statRes{code: settings.CodeUnavailable}
	}

	out := &projectJSON{Root: root, Path: projPath, Name: proj.Name, Settings: proj.Settings,
		Entries: []projectEntryJSON{}}
	if hasOpen {
		st := statOf(openRes.path)
		kind := fsroot.ClassifyName(openRes.path)
		switch {
		case st.code != "":
			warn(st.code, "", *proj.Open)
		case st.dir || openRes.dirHint || (kind != fsroot.FileKindMarkdown && kind != fsroot.FileKindDiagram && kind != fsroot.FileKindText):
			warn(settings.CodeNotAFile, "", *proj.Open)
		default:
			out.Open = &projectOpenJSON{Root: root, Path: openRes.path, Kind: string(kind)}
		}
	}
	for i, ref := range proj.Include {
		res := includes[i]
		if res.dup {
			continue
		}
		if res.code != "" {
			warn(res.code, res.reason, ref)
			continue
		}
		st := statOf(res.path)
		switch {
		case st.code != "":
			warn(st.code, "", ref)
		case res.dirHint && !st.dir:
			warn(settings.CodeNotADir, "", ref)
		case st.dir:
			out.Entries = append(out.Entries, projectEntryJSON{Root: root, Path: res.path, Type: "dir",
				Kind: string(fsroot.FileKindOther), Ref: settings.Sanitize(ref.Text, settings.MaxRefRunes), Line: ref.Line})
		default:
			out.Entries = append(out.Entries, projectEntryJSON{Root: root, Path: res.path, Type: "file",
				Kind: string(fsroot.ClassifyName(res.path)), Ref: settings.Sanitize(ref.Text, settings.MaxRefRunes), Line: ref.Line})
		}
	}
	out.Warnings = settings.CapWarnings(warns)
	if parserTruncated && out.Warnings[len(out.Warnings)-1].Code != settings.CodeWarningsTruncated {
		// The parser had already cut the list; resolution added nothing, so
		// CapWarnings saw exactly the maximum and did not re-add the marker.
		out.Warnings = append(out.Warnings, settings.NewWarning(settings.CodeWarningsTruncated, "further warnings were omitted", "", "", 0))
	}
	if out.Warnings == nil {
		out.Warnings = []settings.Warning{}
	}
	return out, nil
}

// statPaths stats every path through the handle's shared stat limiter, under
// 2*FSTimeout for the whole phase. Paths not reached in time are absent from
// the result (the caller reports them as unavailable).
func (s *Server) statPaths(ctx context.Context, h *fsroot.Handle, paths []string) map[string]statRes {
	ctx, cancel := context.WithTimeout(ctx, 2*s.cfg.FSTimeout)
	defer cancel()
	res := make(map[string]statRes, len(paths))
	var (
		mu   sync.Mutex
		next atomic.Int64
		wg   sync.WaitGroup
	)
	for range min(len(paths), h.StatLimit()) {
		wg.Go(func() {
			for ctx.Err() == nil {
				i := int(next.Add(1)) - 1
				if i >= len(paths) {
					return
				}
				fi, err := h.LimitedStat(ctx, paths[i])
				st := statRes{}
				if err != nil {
					st.code = warnCode(err)
				} else {
					st.dir = fi.IsDir()
				}
				mu.Lock()
				res[paths[i]] = st
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	return res
}
