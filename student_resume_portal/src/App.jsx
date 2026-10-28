import { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Search,
  Download,
  Eye,
  Trash2,
  LogOut,
  Users,
  Clock3,
  RefreshCw,
  LockKeyhole,
} from 'lucide-react';
import { supabase } from './supabase';

const MAX_BYTES = 10 * 1024 * 1024;

function formatDate(value) {
  if (!value) return 'Not uploaded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

async function hasPdfSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return new TextDecoder().decode(bytes) === '%PDF-';
}

export default function App() {
  const [tab, setTab] = useState('student');
  const [prn, setPrn] = useState('');
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) await checkAdmin(sessionUser);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const sessionUser = session?.user ?? null;
        setUser(sessionUser);
        if (!sessionUser) setIsAdmin(false);
        else setTimeout(() => checkAdmin(sessionUser), 0);
      }
    );
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isAdmin) loadAdminRows();
  }, [isAdmin]);

  async function checkAdmin(sessionUser) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', sessionUser.id)
      .maybeSingle();
    setIsAdmin(!error && !!data);
  }

  async function loadAdminRows() {
    setLoadingRows(true);
    setStatus(null);
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('prn, original_name, size_bytes, uploaded_at')
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (error) {
      setStatus({
        type: 'error',
        text: error.message || 'Unable to load resumes.',
      });
    } finally {
      setLoadingRows(false);
    }
  }

  async function submitResume(event) {
    event.preventDefault();
    setStatus(null);
    const normalizedPrn = prn.trim().toUpperCase();

    if (!normalizedPrn) {
      setStatus({ type: 'error', text: 'Enter your PRN.' });
      return;
    }
    if (!file) {
      setStatus({ type: 'error', text: 'Choose a PDF resume first.' });
      return;
    }
    if (
      file.size <= 0 ||
      file.size > MAX_BYTES ||
      !(
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      )
    ) {
      setStatus({
        type: 'error',
        text: 'Select a PDF file no larger than 10 MB.',
      });
      return;
    }
    if (!(await hasPdfSignature(file))) {
      setStatus({
        type: 'error',
        text: 'This file does not appear to be a valid PDF.',
      });
      return;
    }

    setBusy(true);
    setProgress(true);
    try {
      const form = new FormData();
      form.append('prn', normalizedPrn);
      form.append('resume', file, file.name);

      const { data, error } = await supabase.functions.invoke('upload-resume', {
        body: form,
      });
      if (error) {
        let message = error.message || 'Upload failed.';
        try {
          const context = error.context;
          if (context && typeof context.json === 'function') {
            const payload = await context.json();
            if (payload?.error) message = payload.error;
          }
        } catch {}
        throw new Error(message);
      }
      if (!data?.success) throw new Error(data?.error || 'Upload failed.');
      setStatus({
        type: 'success',
        text: 'Resume uploaded successfully. Your previous resume, if any, has been replaced.',
      });
      setFile(null);
      const input = document.getElementById('resume-file');
      if (input) input.value = '';
    } catch (error) {
      setStatus({
        type: 'error',
        text:
          error.message ||
          'Upload failed. Your previous resume should remain available if validation failed.',
      });
    } finally {
      setBusy(false);
      setProgress(false);
    }
  }

  async function adminLogin(event) {
    event.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmail.trim(),
        password: adminPassword,
      });
      if (error) throw error;
      await checkAdmin(data.user);
      const { data: adminRow, error: adminError } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', data.user.id)
        .maybeSingle();
      if (adminError || !adminRow) {
        await supabase.auth.signOut();
        throw new Error(
          'This account is not authorized as a placement administrator.'
        );
      }
      setTab('admin');
      setAdminPassword('');
      setStatus({ type: 'success', text: 'Administrator signed in.' });
    } catch (error) {
      setStatus({
        type: 'error',
        text: error.message || 'Admin sign-in failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function getResumeUrl(row) {
    try {
      const { data, error } = await supabase.functions.invoke(
        'admin-resume-download',
        {
          body: { prn: row.prn },
        }
      );

      if (error) throw error;

      if (!data?.url) {
        throw new Error('Could not create a secure resume link.');
      }

      return data.url;
    } catch (error) {
      setStatus({
        type: 'error',
        text: error.message || 'Could not access this resume.',
      });
      return null;
    }
  }

  async function viewResume(row) {
    const url = await getResumeUrl(row);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async function downloadResume(row) {
    const url = await getResumeUrl(row);
    if (!url) return;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${row.prn}-resume.pdf`;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function deleteResume(row) {
    const confirmed = window.confirm(
      `Permanently delete the resume for ${row.prn}? This action cannot be undone.`
    );

    if (!confirmed) return;

    setStatus(null);
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        'admin-resume-delete',
        {
          body: { prn: row.prn },
        }
      );

      if (error) {
        let message = error.message || 'Could not delete the resume.';

        try {
          if (error.context && typeof error.context.json === 'function') {
            const payload = await error.context.json();
            if (payload?.error) message = payload.error;
          }
        } catch {}

        throw new Error(message);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Could not delete the resume.');
      }

      // Remove the deleted record from the dashboard immediately.
      setRows((currentRows) =>
        currentRows.filter((item) => item.prn !== row.prn)
      );

      setStatus({
        type: 'success',
        text: `Resume for ${row.prn} deleted successfully.`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        text: error.message || 'Could not delete the resume.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setRows([]);
    setTab('student');
    setStatus(null);
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toUpperCase();
    return rows.filter((row) => row.prn.toUpperCase().includes(term));
  }, [rows, search]);

  return (
    <main className="page">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('student');
          }}
        >
          <span className="brand-mark">
            <FileText size={21} />
          </span>
          <span>
            <strong>Resume Portal</strong>
            <small>Student Placement Cell</small>
          </span>
        </a>
        <div className="top-actions">
          {isAdmin && (
            <span className="admin-pill">
              <ShieldCheck size={14} /> Administrator
            </span>
          )}
          {user && (
            <button
              className="button button-quiet button-small"
              onClick={logout}
            >
              <LogOut size={15} /> Sign out
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <span className="eyebrow">STUDENT CAREER SERVICES</span>
        <h1>
          Your resume, <span>always up to date.</span>
        </h1>
        <p>
          Submit your latest resume securely for placement opportunities.
          Uploading again replaces your previous file.
        </p>
      </section>

      <nav className="tabs" aria-label="Portal navigation">
        <button
          className={tab === 'student' ? 'tab active' : 'tab'}
          onClick={() => {
            setTab('student');
            setStatus(null);
          }}
        >
          <UploadCloud size={16} /> Student upload
        </button>
        <button
          className={tab === 'admin' ? 'tab active' : 'tab'}
          onClick={() => {
            setTab('admin');
            setStatus(null);
          }}
        >
          <LockKeyhole size={16} /> Admin
        </button>
      </nav>

      {status && (
        <div className={`notice ${status.type}`} role="status">
          {status.type === 'success' ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
          <span>{status.text}</span>
          <button aria-label="Dismiss message" onClick={() => setStatus(null)}>
            ×
          </button>
        </div>
      )}

      {tab === 'student' && (
        <section className="panel upload-panel">
          <div className="panel-heading">
            <div className="icon-tile">
              <UploadCloud size={22} />
            </div>
            <div>
              <h2>Upload your resume</h2>
              <p>Enter your college PRN and attach your latest PDF.</p>
            </div>
          </div>
          <form onSubmit={submitResume} className="form">
            <label htmlFor="prn">Permanent Registration Number (PRN)</label>
            <input
              id="prn"
              className="text-input"
              value={prn}
              onChange={(e) => setPrn(e.target.value)}
              placeholder="Enter your PRN"
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
            />
            <div className="field-help">
              Use the PRN provided by your college. It must match the approved
              student list.
            </div>

            <label htmlFor="resume-file" className="file-label">
              Resume PDF
            </label>
            <label
              className={`dropzone ${file ? 'has-file' : ''}`}
              htmlFor="resume-file"
            >
              <input
                id="resume-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={busy}
              />
              <span className="drop-icon">
                <FileText size={25} />
              </span>
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span>
                    {(file.size / (1024 * 1024)).toFixed(2)} MB · PDF file
                    selected
                  </span>
                </>
              ) : (
                <>
                  <strong>Choose your resume PDF</strong>
                  <span>Click to browse · Maximum file size 10 MB</span>
                </>
              )}
            </label>
            <div className="security-note">
              <ShieldCheck size={16} />
              <span>
                Only PDF files are accepted. Your new resume replaces the
                previous version after validation.
              </span>
            </div>
            {progress && (
              <div className="progress-wrap">
                <div className="progress-label">
                  <span>Uploading and validating…</span>
                  <span>Please wait</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar indeterminate" />
                </div>
              </div>
            )}
            <button
              className="button button-primary submit-button"
              type="submit"
              disabled={busy}
            >
              {busy ? (
                <RefreshCw className="spin" size={17} />
              ) : (
                <UploadCloud size={17} />
              )}
              {busy ? 'Please wait…' : 'Upload resume'}
            </button>
          </form>
          <div className="privacy-foot">
            <LockKeyhole size={14} />
            <span>
              Resumes are stored in a private bucket. Access is restricted by
              server-side validation and administrator permissions.
            </span>
          </div>
        </section>
      )}

      {tab === 'admin' && !isAdmin && (
        <section className="panel admin-login">
          <div className="panel-heading">
            <div className="icon-tile">
              <LockKeyhole size={22} />
            </div>
            <div>
              <h2>Administrator sign in</h2>
              <p>Authorized placement-cell staff only.</p>
            </div>
          </div>
          <form className="form" onSubmit={adminLogin}>
            <label htmlFor="admin-email">Admin email</label>
            <input
              id="admin-email"
              className="text-input"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              className="text-input"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              className="button button-primary submit-button"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in to dashboard'}
            </button>
          </form>
          <p className="login-hint">
            Create the admin user in Supabase Authentication, then insert their
            user ID into the <code>admin_users</code> table using the SQL
            Editor.
          </p>
        </section>
      )}

      {tab === 'admin' && isAdmin && (
        <section className="panel dashboard">
          <div className="dashboard-heading">
            <div>
              <h2>Resume submissions</h2>
              <p>One current resume record per approved PRN.</p>
            </div>
            <button
              className="button button-secondary button-small"
              onClick={loadAdminRows}
              disabled={loadingRows}
            >
              <RefreshCw size={15} className={loadingRows ? 'spin' : ''} />{' '}
              Refresh
            </button>
          </div>
          <div className="stats-row">
            <div className="stat-card">
              <span className="stat-icon">
                <Users size={18} />
              </span>
              <span className="stat-label">Resumes uploaded</span>
              <strong>{rows.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Clock3 size={18} />
              </span>
              <span className="stat-label">Last updated</span>
              <strong className="stat-date">
                {rows.length ? formatDate(rows[0].uploaded_at) : '—'}
              </strong>
            </div>
          </div>
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by PRN"
              />
            </div>
            <span className="result-count">{filteredRows.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student PRN</th>
                  <th>Last uploaded</th>
                  <th>File</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingRows ? (
                  <tr>
                    <td colSpan="4" className="empty">
                      Loading submissions…
                    </td>
                  </tr>
                ) : filteredRows.length ? (
                  filteredRows.map((row) => (
                    <tr key={row.prn}>
                      <td>
                        <strong>{row.prn}</strong>
                      </td>
                      <td>{formatDate(row.uploaded_at)}</td>
                      <td>
                        <span className="pdf-chip">
                          <FileText size={14} /> PDF
                        </span>
                      </td>
                      <td>
                        <div className="resume-actions">
                          <button
                            type="button"
                            className="view-button"
                            onClick={() => viewResume(row)}
                          >
                            <Eye size={15} /> View Resume
                          </button>

                          <button
                            type="button"
                            className="download-button"
                            onClick={() => downloadResume(row)}
                          >
                            <Download size={15} /> Download
                          </button>

                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => deleteResume(row)}
                            disabled={busy}
                            title={`Delete resume for ${row.prn}`}
                          >
                            <Trash2 size={15} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="empty">
                      No submissions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="table-footnote">
            Student names are not collected in this version; the PRN is the
            record identifier.
          </p>
        </section>
      )}

      <footer className="footer">
        <span>Student Resume Portal</span>
        <span>Secure submissions · PDF only · 10 MB limit</span>
      </footer>
    </main>
  );
}
