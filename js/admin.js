// ==================================================================
// Admin panel logic
// ==================================================================

let adminTeams = [];
let adminMatches = [];
let adminGroups = [];
let adminStandings = [];
let settings = null;
let teamsSearchQuery = '';
let approvalsSearchQuery = '';
let matchesSearchQuery = '';

const ADMIN_SECTIONS = ['adminTeams', 'adminGroups', 'adminBracket', 'adminApprovals', 'adminMatches', 'adminSettings'];

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initLoginForm();
  document.getElementById('logoutBtn').addEventListener('click', () => sb.auth.signOut());
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);
  document.getElementById('resetTournamentBtn').addEventListener('click', resetTournament);
  document.getElementById('bracketAddForm').addEventListener('submit', addFixture);
  document.getElementById('byeForm').addEventListener('submit', addBye);
  document.getElementById('addGroupForm').addEventListener('submit', addGroup);
  document.getElementById('startGroupStageBtn').addEventListener('click', startGroupStage);
  document.getElementById('finalizeGroupsBtn').addEventListener('click', finalizeGroupStage);
  document.getElementById('teamsSearch').addEventListener('input', (e) => {
    teamsSearchQuery = e.target.value.trim().toLowerCase();
    renderTeamsAdmin();
  });
  document.getElementById('approvalsSearch').addEventListener('input', (e) => {
    approvalsSearchQuery = e.target.value.trim().toLowerCase();
    renderApprovals();
  });
  document.getElementById('matchesSearch').addEventListener('input', (e) => {
    matchesSearchQuery = e.target.value.trim().toLowerCase();
    renderMatchesAdmin();
  });

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) showDashboard(); else showLogin();
  });
  checkSession();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

async function checkSession(){
  const { data: { session } } = await sb.auth.getSession();
  if (session) showDashboard(); else showLogin();
}

function showLogin(){
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}

function showDashboard(){
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminShell').style.display = 'block';
  const hashTarget = location.hash.slice(1);
  activateSection(ADMIN_SECTIONS.includes(hashTarget) ? hashTarget : 'adminTeams');
  loadAllAdmin();
  subscribeAdminRealtime();
}

function initLoginForm(){
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loginMsg');
    msg.className = 'msg';
    const btn = form.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Signing in…';
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) {
      msg.classList.add('show', 'msg-err');
      msg.textContent = error.message;
    }
  });
}

function initNav(){
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activateSection(btn.dataset.target);
      history.replaceState(null, '', '#' + btn.dataset.target);
    });
  });
  window.addEventListener('hashchange', () => {
    const target = location.hash.slice(1);
    if (ADMIN_SECTIONS.includes(target)) activateSection(target);
  });
}

function activateSection(target){
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target === target));
  document.querySelectorAll('.admin-view').forEach(v => v.classList.toggle('active', v.id === target));
}

async function loadAllAdmin(){
  await Promise.all([loadTeamsAdmin(), loadMatchesAdmin(), loadSettingsAdmin(), loadGroupsAdmin()]);
  updateApprovalsBadge();
  renderTeamsAdmin();
  renderGroupsAdmin();
  renderBracketBuilder();
  renderApprovals();
  renderMatchesAdmin();
}

function subscribeAdminRealtime(){
  sb.channel('admin-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadMatchesAdmin().then(() => { updateApprovalsBadge(); renderBracketBuilder(); renderApprovals(); renderMatchesAdmin(); }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadTeamsAdmin().then(() => { updateApprovalsBadge(); renderTeamsAdmin(); renderBracketBuilder(); renderGroupsAdmin(); }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => loadGroupsAdmin().then(renderGroupsAdmin))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_settings' }, () => loadSettingsAdmin().then(() => { renderGroupsAdmin(); renderBracketBuilder(); }))
    .subscribe();
}

async function loadTeamsAdmin(){
  const { data, error } = await sb.from('teams').select('*').order('created_at', { ascending: true });
  if (!error) adminTeams = data || [];
}

async function loadGroupsAdmin(){
  const [{ data: groups, error: gErr }, { data: standings, error: sErr }] = await Promise.all([
    sb.from('groups').select('*').order('name', { ascending: true }),
    sb.from('group_standings').select('*')
  ]);
  if (!gErr) adminGroups = groups || [];
  if (!sErr) adminStandings = standings || [];
}

async function loadMatchesAdmin(){
  const { data, error } = await sb
    .from('matches')
    .select('*, team1:team1_id(id,team_name), team2:team2_id(id,team_name)')
    .order('round', { ascending: true })
    .order('match_index', { ascending: true });
  if (!error) adminMatches = data || [];
}

async function loadSettingsAdmin(){
  const { data, error } = await sb.from('tournament_settings').select('*').eq('id', 1).single();
  if (!error) {
    settings = data;
    document.getElementById('settingsName').value = data.tournament_name;
    document.getElementById('settingsQualifiers').value = data.qualifiers_per_group ?? 2;
    const statusEl = document.getElementById('settingsStatus');
    const statusText = {
      registration: 'registration', group_stage: 'group stage', knockout: 'knockout',
      ongoing: 'knockout', completed: 'completed'
    }[data.status] || data.status;
    statusEl.textContent = statusText;
    statusEl.className = 'badge ' + (
      data.status === 'knockout' || data.status === 'ongoing' ? 'badge-live' :
      data.status === 'group_stage' ? 'badge-pending' :
      data.status === 'completed' ? 'badge-champion' : 'badge-pending'
    );
  }
}

// ---------------- approvals nav badge ----------------

function updateApprovalsBadge(){
  const pendingCount = adminMatches.filter(m => m.status === 'pending_approval').length;
  const navBadge = document.getElementById('approvalsNavBadge');
  navBadge.textContent = pendingCount > 0 ? pendingCount : '';
  navBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
}

// ---------------- teams admin ----------------

function renderTeamsAdmin(){
  const wrap = document.getElementById('teamsAdminTable');
  if (!adminTeams.length) {
    wrap.innerHTML = `<div class="empty-state">No teams have registered yet.</div>`;
    return;
  }
  const q = teamsSearchQuery;
  const filtered = !q ? adminTeams : adminTeams.filter(t =>
    (t.team_name || '').toLowerCase().includes(q) ||
    (t.owner_name || '').toLowerCase().includes(q) ||
    (t.phone || '').toLowerCase().includes(q) ||
    (t.code || '').toLowerCase().includes(q)
  );
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state">No teams match "${escapeHtml(teamsSearchQuery)}".</div>`;
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Team</th><th>Owner</th><th>Phone</th><th>Preferred time</th><th>Code</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${filtered.map(t => `
        <tr>
          <td>${escapeHtml(t.team_name)}</td>
          <td>${escapeHtml(t.owner_name || '—')}</td>
          <td class="mono">${escapeHtml(t.phone)}</td>
          <td>${escapeHtml(t.preferred_time || '—')}</td>
          <td>
            <div class="code-cell">
              <span class="code-pill">${escapeHtml(t.code)}</span>
              <button type="button" class="copy-btn" data-copy="${escapeHtml(t.code)}">Copy</button>
            </div>
          </td>
          <td>
            <span class="badge ${t.status === 'active' ? 'badge-live' : t.status === 'champion' ? 'badge-champion' : 'badge-eliminated'}">${t.status}</span>
            ${isRecoveryLocked(t) ? `<span class="badge badge-disputed" style="margin-left:6px;" title="Too many failed code-recovery attempts">🔒 Recovery locked</span>` : ''}
          </td>
          <td>
            <div class="pill-row">
              ${t.status !== 'withdrawn' ? `<button class="btn btn-sm btn-danger" data-withdraw="${t.id}">Withdraw</button>` : `<button class="btn btn-sm" data-reactivate="${t.id}">Reactivate</button>`}
              ${isRecoveryLocked(t) ? `<button class="btn btn-sm" data-unlock-recovery="${t.id}">Unlock</button>` : ''}
              <button class="btn btn-sm btn-danger" data-delete-team="${t.id}" data-team-name="${escapeHtml(t.team_name)}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table></div>`;

  wrap.querySelectorAll('[data-withdraw]').forEach(btn => btn.addEventListener('click', () => {
    if (confirm('Withdraw this team? They\'ll be marked eliminated but stay on record.')) setTeamStatus(btn.dataset.withdraw, 'withdrawn');
  }));
  wrap.querySelectorAll('[data-reactivate]').forEach(btn => btn.addEventListener('click', () => setTeamStatus(btn.dataset.reactivate, 'active')));
  wrap.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyCode(btn)));
  wrap.querySelectorAll('[data-delete-team]').forEach(btn => btn.addEventListener('click', () => deleteTeam(btn.dataset.deleteTeam, btn.dataset.teamName)));
  wrap.querySelectorAll('[data-unlock-recovery]').forEach(btn => btn.addEventListener('click', () => unlockRecovery(btn.dataset.unlockRecovery)));
}

function isRecoveryLocked(t){
  return !!t.recovery_locked_until && new Date(t.recovery_locked_until) > new Date();
}

async function unlockRecovery(id){
  await sb.from('teams').update({ recovery_attempts: 0, recovery_locked_until: null }).eq('id', id);
  loadTeamsAdmin().then(renderTeamsAdmin);
}

function copyCode(btn){
  const code = btn.dataset.copy;
  const done = () => {
    const original = 'Copy';
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(done);
  } else {
    done();
  }
}

async function setTeamStatus(id, status){
  await sb.from('teams').update({ status }).eq('id', id);
  loadTeamsAdmin().then(renderTeamsAdmin);
}

function teamHasFixtures(id){
  return adminMatches.some(m => m.team1_id === id || m.team2_id === id);
}

async function deleteTeam(id, teamName){
  if (teamHasFixtures(id)) {
    alert(`"${teamName}" already has a fixture in the bracket, so it can't be deleted (that would break match history). Withdraw it instead — that removes it from the public "still in" list without deleting the record.`);
    return;
  }
  if (!confirm(`Permanently delete "${teamName}"? This can't be undone.`)) return;

  // if this team is still on record as tournament champion, clear that
  // reference first — otherwise the delete is blocked by a foreign key
  await sb.from('tournament_settings').update({ champion_id: null }).eq('champion_id', id);

  const { data, error } = await sb.from('teams').delete().eq('id', id).select();
  if (error) { alert(error.message); return; }
  if (!data || !data.length) {
    alert(`Nothing was deleted. Make sure supabase/schema.sql has been run on this project — it grants signed-in admins delete access on "teams".`);
    return;
  }
  loadTeamsAdmin().then(renderTeamsAdmin);
}

// ---------------- groups admin ----------------

function renderGroupsAdmin(){
  const body = document.getElementById('groupsAdminBody');
  const lockedNote = document.getElementById('groupsLockedNote');
  const unavailableNote = document.getElementById('groupsUnavailableNote');
  const isRegistration = settings && settings.status === 'registration';
  const isGroupStage = settings && settings.status === 'group_stage';

  // groups can be created/edited only during registration; once the
  // group stage starts, this tab becomes read-only (standings + finalize)
  body.style.display = (isRegistration || isGroupStage) ? '' : 'none';
  unavailableNote.style.display = (isRegistration || isGroupStage) ? 'none' : 'block';
  lockedNote.style.display = isGroupStage ? 'block' : 'none';

  document.getElementById('addGroupForm').style.display = isRegistration ? '' : 'none';

  renderGroupsList(isRegistration);
  renderGroupsStandingsAdmin();

  const startWrap = document.getElementById('startGroupStageBtn').closest('.glass');
  const startBtn = document.getElementById('startGroupStageBtn');
  const unassignedActive = adminTeams.filter(t => t.status === 'active' && !t.group_id).length;
  startWrap.style.display = isRegistration ? '' : 'none';
  startBtn.disabled = !(isRegistration && adminGroups.length > 0 && adminTeams.some(t => t.status === 'active') && unassignedActive === 0);

  const finalizeWrap = document.getElementById('finalizeGroupsBtn').closest('.glass');
  const finalizeBtn = document.getElementById('finalizeGroupsBtn');
  const groupMatches = adminMatches.filter(m => (m.phase || 'knockout') === 'group');
  const unapproved = groupMatches.filter(m => m.status !== 'approved').length;
  finalizeWrap.style.display = isGroupStage ? '' : 'none';
  finalizeBtn.disabled = !(isGroupStage && groupMatches.length > 0 && unapproved === 0);
}

function renderGroupsList(editable){
  const wrap = document.getElementById('groupsList');
  if (!adminGroups.length) {
    wrap.innerHTML = `<div class="empty-state">No groups yet — add one above.</div>`;
    return;
  }
  wrap.innerHTML = adminGroups.map(g => {
    const teamsInGroup = adminTeams.filter(t => t.group_id === g.id);
    const otherTeams = adminTeams.filter(t => t.status === 'active' && !t.group_id);
    return `<div class="glass glass-pad" style="margin-bottom:14px;">
      <div class="pill-row" style="justify-content:space-between; margin-bottom:10px;">
        <h3 style="margin:0;">${escapeHtml(g.name)}</h3>
        ${editable ? `<button class="btn btn-sm btn-danger" data-del-group="${g.id}">Delete</button>` : ''}
      </div>
      ${teamsInGroup.length ? `<div class="pill-row" style="margin-bottom:${editable ? '12px' : '0'};">
        ${teamsInGroup.map(t => `<span class="badge badge-live">
          ${escapeHtml(t.team_name)}
          ${editable ? `<button type="button" data-unassign="${t.id}" style="border:none;background:none;color:inherit;cursor:pointer;margin-left:4px;font-weight:800;">&times;</button>` : ''}
        </span>`).join('')}
      </div>` : `<div class="hint" style="margin-bottom:${editable ? '12px' : '0'};">No teams assigned yet.</div>`}
      ${editable && otherTeams.length ? `
        <div class="field" style="margin-bottom:0;">
          <select data-assign-into="${g.id}">
            <option value="">Add a team…</option>
            ${otherTeams.map(t => `<option value="${t.id}">${escapeHtml(t.team_name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
    </div>`;
  }).join('');

  if (editable) {
    wrap.querySelectorAll('[data-del-group]').forEach(btn => btn.addEventListener('click', () => deleteGroup(btn.dataset.delGroup)));
    wrap.querySelectorAll('[data-unassign]').forEach(btn => btn.addEventListener('click', () => assignTeamToGroup(btn.dataset.unassign, null)));
    wrap.querySelectorAll('[data-assign-into]').forEach(sel => sel.addEventListener('change', (e) => {
      if (e.target.value) assignTeamToGroup(e.target.value, e.target.dataset.assignInto);
    }));
  }
}

function renderGroupsStandingsAdmin(){
  const wrap = document.getElementById('groupsStandingsAdmin');
  if (!adminGroups.length) {
    wrap.innerHTML = `<div class="empty-state">No groups yet.</div>`;
    return;
  }
  const qualifiers = (settings && settings.qualifiers_per_group) || 2;
  wrap.innerHTML = `<div class="groups-grid">${adminGroups.map(g => {
    const rows = adminStandings.filter(r => r.group_id === g.id).sort((a,b) => a.position - b.position);
    if (!rows.length) {
      return `<div class="glass group-card"><h3>${escapeHtml(g.name)}</h3><div class="group-hint">No teams assigned.</div></div>`;
    }
    return `<div class="glass group-card">
      <h3>${escapeHtml(g.name)}</h3>
      <div class="table-wrap" style="box-shadow:none; padding:0;">
        <table class="standings-table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr class="${r.position <= qualifiers ? 'qualified' : ''}">
                <td><span class="pos-cell">${r.position}</span></td>
                <td>${escapeHtml(r.team_name)}</td>
                <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
                <td>${r.goal_diff > 0 ? '+' : ''}${r.goal_diff}</td>
                <td class="pts">${r.points}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('')}</div>`;
}

async function addGroup(e){
  e.preventDefault();
  const input = document.getElementById('newGroupName');
  const msg = document.getElementById('addGroupMsg');
  msg.className = 'msg';
  const name = input.value.trim();
  if (!name) { msg.classList.add('show','msg-err'); msg.textContent = 'Enter a group name.'; return; }
  const { error } = await sb.from('groups').insert({ name });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  input.value = '';
  loadGroupsAdmin().then(renderGroupsAdmin);
}

async function deleteGroup(id){
  const hasTeams = adminTeams.some(t => t.group_id === id);
  if (hasTeams) { alert('Remove every team from this group before deleting it.'); return; }
  if (!confirm('Delete this group?')) return;
  const { error } = await sb.from('groups').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  loadGroupsAdmin().then(renderGroupsAdmin);
}

async function assignTeamToGroup(teamId, groupId){
  const { error } = await sb.from('teams').update({ group_id: groupId }).eq('id', teamId);
  if (error) { alert(error.message); return; }
  await loadTeamsAdmin();
  renderGroupsAdmin();
  renderTeamsAdmin();
}

async function startGroupStage(){
  const msg = document.getElementById('startGroupStageMsg');
  msg.className = 'msg';
  const btn = document.getElementById('startGroupStageBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Starting…';
  const { error } = await sb.rpc('start_group_stage');
  btn.innerHTML = 'Start group stage';
  if (error) {
    msg.classList.add('show','msg-err'); msg.textContent = error.message;
    btn.disabled = false;
    return;
  }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Group stage started — fixtures are live.';
  loadAllAdmin();
}

async function finalizeGroupStage(){
  const msg = document.getElementById('finalizeGroupsMsg');
  msg.className = 'msg';
  if (!confirm('Finalize the group stage and open the knockout bracket? This eliminates every team that didn\'t qualify.')) return;
  const btn = document.getElementById('finalizeGroupsBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Finalizing…';
  const { error } = await sb.rpc('finalize_group_stage');
  btn.innerHTML = 'Finalize &amp; start knockouts';
  if (error) {
    msg.classList.add('show','msg-err'); msg.textContent = error.message;
    btn.disabled = false;
    return;
  }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Knockout stage is live.';
  loadAllAdmin();
}

// ---------------- bracket builder ----------------

function usedTeamIdsInRound1(){
  const used = new Set();
  adminMatches.filter(m => m.round === 1 && (m.phase || 'knockout') === 'knockout').forEach(m => {
    if (m.team1_id) used.add(m.team1_id);
    if (m.team2_id) used.add(m.team2_id);
  });
  return used;
}

function renderBracketBuilder(){
  const used = usedTeamIdsInRound1();
  const available = adminTeams.filter(t => t.status === 'active' && !used.has(t.id));

  const sel1 = document.getElementById('fixtureTeam1');
  const sel2 = document.getElementById('fixtureTeam2');
  const byeSel = document.getElementById('byeTeam');
  const opts = available.map(t => `<option value="${t.id}">${escapeHtml(t.team_name)}</option>`).join('');
  sel1.innerHTML = `<option value="">Team A…</option>${opts}`;
  sel2.innerHTML = `<option value="">Team B…</option>${opts}`;
  byeSel.innerHTML = `<option value="">Select team…</option>${opts}`;

  const round1 = adminMatches.filter(m => m.round === 1 && (m.phase || 'knockout') === 'knockout')
    .sort((a,b) => a.match_index - b.match_index);
  const list = document.getElementById('round1List');
  if (!round1.length) {
    list.innerHTML = `<div class="empty-state">No Round 1 fixtures created yet.</div>`;
  } else {
    list.innerHTML = round1.map(m => `
      <div class="list-item">
        <div>${escapeHtml(m.team1?.team_name || 'TBD')} ${m.is_bye ? '<span class="hint">(bye)</span>' : 'vs ' + escapeHtml(m.team2?.team_name || 'TBD')}</div>
        <div class="pill-row">
          <span class="badge ${(STATUS_LABEL_ADMIN[m.status]||{}).cls || ''}">${(STATUS_LABEL_ADMIN[m.status]||{}).text || m.status}</span>
          ${settings && settings.status === 'registration' ? `<button class="btn btn-sm btn-danger" data-del-match="${m.id}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-del-match]').forEach(btn => btn.addEventListener('click', () => deleteMatch(btn.dataset.delMatch)));
  }

  const usingGroups = adminGroups && adminGroups.length > 0;
  const skipGroupsNote = document.getElementById('bracketSkipGroupsNote');
  if (skipGroupsNote) skipGroupsNote.style.display = usingGroups ? 'block' : 'none';
  document.getElementById('bracketAddForm').style.display = usingGroups ? 'none' : '';
  document.getElementById('byeForm').style.display = usingGroups ? 'none' : '';

  document.getElementById('finalizeBtn').disabled = !(settings && settings.status === 'registration' && round1.length > 0 && !usingGroups);
  document.getElementById('bracketLockedNote').style.display = settings && settings.status !== 'registration' ? 'block' : 'none';

  document.getElementById('finalizeBtn').onclick = finalizeBracket;
}

async function nextMatchIndex(round){
  const existing = adminMatches.filter(m => m.round === round && (m.phase || 'knockout') === 'knockout');
  return existing.length;
}

async function addFixture(e){
  e.preventDefault();
  const t1 = document.getElementById('fixtureTeam1').value;
  const t2 = document.getElementById('fixtureTeam2').value;
  const msg = document.getElementById('bracketMsg');
  msg.className = 'msg';
  if (!t1 || !t2 || t1 === t2) {
    msg.classList.add('show','msg-err'); msg.textContent = 'Pick two different teams.';
    return;
  }
  const idx = await nextMatchIndex(1);
  const { error } = await sb.from('matches').insert({
    phase: 'knockout', round: 1, match_index: idx, team1_id: t1, team2_id: t2, status: 'awaiting_schedule'
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Fixture added.';
  document.getElementById('bracketAddForm').reset();
  loadMatchesAdmin().then(renderBracketBuilder);
}

async function addBye(e){
  e.preventDefault();
  const t1 = document.getElementById('byeTeam').value;
  const msg = document.getElementById('byeMsg');
  msg.className = 'msg';
  if (!t1) { msg.classList.add('show','msg-err'); msg.textContent = 'Select a team.'; return; }
  const idx = await nextMatchIndex(1);
  const { error } = await sb.from('matches').insert({
    phase: 'knockout', round: 1, match_index: idx, team1_id: t1, is_bye: true, status: 'awaiting_schedule'
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Bye added — remember to confirm it once the bracket is finalized.';
  document.getElementById('byeForm').reset();
  loadMatchesAdmin().then(renderBracketBuilder);
}

async function deleteMatch(id){
  if (!confirm('Remove this fixture?')) return;
  const { data, error } = await sb.from('matches').delete().eq('id', id).select();
  if (error) { alert(error.message); return; }
  if (!data || !data.length) {
    alert(`Nothing was deleted. Make sure supabase/schema.sql has been run on this project — it grants signed-in admins delete access on "matches".`);
    return;
  }
  loadMatchesAdmin().then(() => { renderBracketBuilder(); renderMatchesAdmin(); });
}

function roundNameFor(round, totalRounds){
  const diff = totalRounds - round;
  if (diff === 0) return 'Final';
  if (diff === 1) return 'Semi-Final';
  if (diff === 2) return 'Quarter-Final';
  return 'Round of ' + Math.pow(2, diff + 1);
}

async function finalizeBracket(){
  const round1 = adminMatches.filter(m => m.round === 1 && (m.phase || 'knockout') === 'knockout');
  if (!round1.length) return;
  const totalRounds = Math.ceil(Math.log2(round1.length)) + 1;
  const msg = document.getElementById('bracketMsg');
  msg.className = 'msg';

  for (const m of round1) {
    await sb.from('matches').update({ round_name: roundNameFor(1, totalRounds) }).eq('id', m.id);
  }
  const { error } = await sb.from('tournament_settings').update({ total_rounds: totalRounds, status: 'knockout' }).eq('id', 1);
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }

  msg.classList.add('show','msg-ok'); msg.textContent = `Bracket locked — ${totalRounds} round(s) to the final.`;
  loadSettingsAdmin();
  loadMatchesAdmin().then(() => { renderBracketBuilder(); renderMatchesAdmin(); });
}

// ---------------- approvals ----------------

function renderApprovals(){
  const list = document.getElementById('approvalsList');
  let pending = adminMatches.filter(m => ['pending_approval','disputed'].includes(m.status));
  if (approvalsSearchQuery) {
    pending = pending.filter(m =>
      (m.team1?.team_name || '').toLowerCase().includes(approvalsSearchQuery) ||
      (m.team2?.team_name || '').toLowerCase().includes(approvalsSearchQuery)
    );
  }
  if (!pending.length) {
    list.innerHTML = `<div class="empty-state">${approvalsSearchQuery ? `No pending matches for "${escapeHtml(approvalsSearchQuery)}".` : 'Nothing waiting on you right now.'}</div>`;
    return;
  }
  list.innerHTML = pending.map(m => {
    const isGroup = (m.phase || 'knockout') === 'group';
    return `
    <div class="glass glass-pad" style="margin-bottom:14px;">
      <div class="pill-row" style="margin-bottom:10px;">
        <span class="badge ${m.status === 'disputed' ? 'badge-disputed' : 'badge-pending'}">${m.status === 'disputed' ? 'Disputed' : 'Pending approval'}</span>
        <span class="hint">${isGroup ? 'Group stage' : (m.round_name || 'Round ' + m.round)}</span>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${escapeHtml(m.team1?.team_name || 'Team A')}</label>
          <input type="number" min="0" id="score1-${m.id}" value="${m.team1_score ?? ''}">
        </div>
        <div class="field">
          <label>${escapeHtml(m.team2?.team_name || 'Team B')}</label>
          <input type="number" min="0" id="score2-${m.id}" value="${m.team2_score ?? ''}">
        </div>
      </div>
      ${isGroup ? '' : `
      <div class="field-row">
        <div class="field">
          <label>${escapeHtml(m.team1?.team_name || 'Team A')} penalties</label>
          <input type="number" min="0" id="pen1-${m.id}" value="${m.team1_penalties ?? ''}">
        </div>
        <div class="field">
          <label>${escapeHtml(m.team2?.team_name || 'Team B')} penalties</label>
          <input type="number" min="0" id="pen2-${m.id}" value="${m.team2_penalties ?? ''}">
        </div>
      </div>`}
      <div class="pill-row">
        <button class="btn btn-primary btn-sm" data-approve="${m.id}">Approve${isGroup ? '' : ' &amp; advance'}</button>
        <button class="btn btn-danger btn-sm" data-dispute="${m.id}">Mark disputed</button>
      </div>
      <div class="msg" id="approveMsg-${m.id}"></div>
    </div>
  `;}).join('');

  list.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => approveMatch(btn.dataset.approve)));
  list.querySelectorAll('[data-dispute]').forEach(btn => btn.addEventListener('click', () => disputeMatch(btn.dataset.dispute)));
}

async function approveMatch(id){
  const msg = document.getElementById(`approveMsg-${id}`);
  msg.className = 'msg';
  const s1 = document.getElementById(`score1-${id}`).value;
  const s2 = document.getElementById(`score2-${id}`).value;
  const p1El = document.getElementById(`pen1-${id}`);
  const p2El = document.getElementById(`pen2-${id}`);
  const p1 = p1El ? p1El.value : '';
  const p2 = p2El ? p2El.value : '';

  const { error } = await sb.rpc('approve_match', {
    p_match_id: id,
    p_score1: s1 === '' ? null : parseInt(s1, 10),
    p_score2: s2 === '' ? null : parseInt(s2, 10),
    p_pen1: p1 === '' ? null : parseInt(p1, 10),
    p_pen2: p2 === '' ? null : parseInt(p2, 10)
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }

  // Best-effort audit trail — approved_by/approved_at are part of
  // supabase/schema.sql, so this should always succeed; it's wrapped
  // defensively anyway since it's not critical to the approval itself.
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    await sb.from('matches').update({ approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id)
      .then(({ error: auditError }) => { if (auditError) console.warn('Audit trail not recorded:', auditError.message); });
  }

  loadAllAdmin();
}

async function disputeMatch(id){
  await sb.from('matches').update({ status: 'disputed' }).eq('id', id);
  loadMatchesAdmin().then(renderApprovals);
}

// ---------------- confirm byes (shown in matches admin too) ----------------

async function confirmBye(id){
  const { error } = await sb.rpc('approve_match', { p_match_id: id });
  if (error) alert(error.message);
  loadAllAdmin();
}

// ---------------- all matches / scheduling ----------------

const STATUS_LABEL_ADMIN = {
  pending_teams: { text: 'TBD', cls: 'badge-eliminated' },
  awaiting_schedule: { text: 'Needs schedule', cls: 'badge-pending' },
  scheduled: { text: 'Scheduled', cls: 'badge-live' },
  pending_approval: { text: 'Pending approval', cls: 'badge-pending' },
  approved: { text: 'Final', cls: 'badge-approved' },
  disputed: { text: 'Disputed', cls: 'badge-disputed' }
};

function renderMatchesAdmin(){
  const wrap = document.getElementById('matchesAdminList');
  if (!adminMatches.length) {
    wrap.innerHTML = `<div class="empty-state">No fixtures yet — build Round 1 first.</div>`;
    return;
  }
  let matches = adminMatches;
  if (matchesSearchQuery) {
    matches = matches.filter(m =>
      (m.team1?.team_name || '').toLowerCase().includes(matchesSearchQuery) ||
      (m.team2?.team_name || '').toLowerCase().includes(matchesSearchQuery)
    );
  }
  if (!matches.length) {
    wrap.innerHTML = `<div class="empty-state">No fixtures match "${escapeHtml(matchesSearchQuery)}".</div>`;
    return;
  }
  const rounds = {};
  matches.forEach(m => {
    const key = (m.phase || 'knockout') === 'group' ? 'group' : 'k' + m.round;
    (rounds[key] = rounds[key] || []).push(m);
  });
  // group stage first (if any), then knockout rounds in order
  const keys = Object.keys(rounds).sort((a,b) => {
    if (a === 'group') return -1;
    if (b === 'group') return 1;
    return parseInt(a.slice(1),10) - parseInt(b.slice(1),10);
  });

  wrap.innerHTML = keys.map(key => `
    <h3 style="margin-top:28px;">${key === 'group' ? 'Group stage' : (rounds[key][0].round_name || ('Round ' + rounds[key][0].round))}</h3>
    ${rounds[key].sort((a,b)=>a.match_index-b.match_index).map(m => `
      <div class="glass list-item">
        <div>
          <div style="font-weight:600;">${escapeHtml(m.team1?.team_name || 'TBD')} ${m.is_bye ? '<span class="hint">(bye)</span>' : 'vs ' + escapeHtml(m.team2?.team_name || 'TBD')}</div>
          <div class="pill-row" style="margin-top:6px;">
            <span class="badge ${(STATUS_LABEL_ADMIN[m.status]||{}).cls||''}">${(STATUS_LABEL_ADMIN[m.status]||{}).text||m.status}</span>
            ${m.scheduled_time ? `<span class="hint mono">${new Date(m.scheduled_time).toLocaleString()}</span>` : ''}
            ${m.status === 'approved' ? `<span class="hint mono">${m.team1_score} - ${m.team2_score}</span>` : ''}
            ${m.status === 'approved' && m.approved_at ? `<span class="hint">Approved ${new Date(m.approved_at).toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="pill-row">
          ${m.is_bye && m.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-confirm-bye="${m.id}">Confirm bye</button>` : ''}
          ${!m.is_bye && m.team1_id && m.team2_id && !['approved'].includes(m.status) ? `
            <input type="datetime-local" id="sched-${m.id}" style="width:auto;">
            <button class="btn btn-sm" data-schedule="${m.id}">Set time</button>
          ` : ''}
          ${!['approved'].includes(m.status) ? `<button class="btn btn-sm btn-danger" data-del="${m.id}">Delete</button>` : ''}
        </div>
      </div>
    `).join('')}
  `).join('');

  wrap.querySelectorAll('[data-schedule]').forEach(btn => btn.addEventListener('click', () => setSchedule(btn.dataset.schedule)));
  wrap.querySelectorAll('[data-confirm-bye]').forEach(btn => btn.addEventListener('click', () => confirmBye(btn.dataset.confirmBye)));
  wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => deleteMatch(btn.dataset.del)));
}

async function setSchedule(id){
  const val = document.getElementById(`sched-${id}`).value;
  if (!val) return;
  await sb.from('matches').update({ scheduled_time: new Date(val).toISOString(), status: 'scheduled' }).eq('id', id);
  loadMatchesAdmin().then(renderMatchesAdmin);
}

// ---------------- settings ----------------

async function saveSettings(e){
  e.preventDefault();
  const msg = document.getElementById('settingsMsg');
  msg.className = 'msg';
  const name = document.getElementById('settingsName').value.trim();
  const qualifiers = parseInt(document.getElementById('settingsQualifiers').value, 10);
  const { error } = await sb.from('tournament_settings')
    .update({ tournament_name: name, qualifiers_per_group: qualifiers })
    .eq('id', 1);
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Saved.';
}

// ---------------- danger zone: full reset ----------------

async function resetTournament(){
  const msg = document.getElementById('resetMsg');
  msg.className = 'msg';

  const typed = prompt(
    `This wipes EVERYTHING: every team, every match, every score — and puts the tournament back to "registration" with zero teams. This cannot be undone.\n\nType RESET to confirm.`
  );
  if (typed !== 'RESET') return;

  const btn = document.getElementById('resetTournamentBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Resetting…';

  try {
    // clear the champion reference FIRST — teams can't be deleted while
    // tournament_settings.champion_id still points at one of them
    const { error: sErr1 } = await sb.from('tournament_settings')
      .update({ status: 'registration', total_rounds: null, champion_id: null })
      .eq('id', 1);
    if (sErr1) throw sErr1;

    const { error: mErr } = await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (mErr) throw mErr;

    const { error: tErr } = await sb.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (tErr) throw tErr;

    const { error: gErr } = await sb.from('groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (gErr) throw gErr;

    msg.classList.add('show', 'msg-ok');
    msg.textContent = 'Tournament reset. Registration is open again with no teams.';
    loadAllAdmin();
  } catch (err) {
    msg.classList.add('show', 'msg-err');
    msg.textContent = err.message || 'Reset failed — check the console.';
  } finally {
    btn.disabled = false; btn.textContent = 'Reset tournament';
  }
}

// ---------------- helpers ----------------

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
