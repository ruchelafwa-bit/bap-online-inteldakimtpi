/* ══════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════ */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx7BnKbxAQVrhgwWAP6kFIOmpXiM4WBi2a3JSc9-LtD1IKiHQWV-VKpJJ0zRza4gfKi/exec';
const CLOUDINARY_URL  = 'https://api.cloudinary.com/v1_1/df5axirwx/upload';
const UPLOAD_PRESET   = 'bap_upload_preset';
const MAX_FILE_SIZE   = 10 * 1024 * 1024;
const MAX_SLOTS       = 2;
const SESSION_KEY     = 'baper_session';
const COMPRESS_MAX_W  = 1280;
const COMPRESS_QUALITY= 0.75;

const SLOT_DEFS = [
  { id:'A', label:'08:00 – 10:00', start:8,  end:10 },
  { id:'B', label:'10:00 – 12:00', start:10, end:12 },
  { id:'C', label:'13:30 – 15:00', start:13, end:15 },
  { id:'D', label:'15:30 – 17:00', start:15, end:17 },
];

/* ══════════════════════════════════════════════
   SESSION
══════════════════════════════════════════════ */
function getSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY))||null; }catch{ return null; } }
function setSession(user){ localStorage.setItem(SESSION_KEY, JSON.stringify(user)); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }
function isLoggedIn(){ return getSession()!==null; }

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let currentStep      = 1;
let selectedSlot     = null;
let registrationData = {};
let slotBookingCache = {};
let slotCacheFetched = {};
let activeUploads    = 0;
let rsSelectedSlot   = null;     // for reschedule modal
let rsSlotCacheDate  = null;
let currentRegData   = null;     // user's existing registration

const uploadedFiles = {
  ktp:null, kk:null, akta:null,
  fotoPaspor:null, suratPolisi:null, suratKelurahan:null,
  suratPemerintah:null, pendukung:null
};

/* ══════════════════════════════════════════════
   PAGE NAVIGATION
══════════════════════════════════════════════ */
function showLanding(){
  ['authPage','mainApp','userDashboardPage'].forEach(id=>{ document.getElementById(id).style.display='none'; });
  document.getElementById('landingPage').style.display='flex';
  updateLandingUserBar();
  window.scrollTo({top:0,behavior:'smooth'});
}

function showAuthPage(){
  ['landingPage','mainApp','userDashboardPage'].forEach(id=>{ document.getElementById(id).style.display='none'; });
  document.getElementById('authPage').style.display='block';
  showLogin();
  window.scrollTo({top:0,behavior:'smooth'});
}

function showLogin(){
  document.getElementById('loginPanel').style.display    = 'block';
  document.getElementById('registerPanel').style.display = 'none';
  clearAuthAlerts();
}

function showRegister(){
  document.getElementById('loginPanel').style.display    = 'none';
  document.getElementById('registerPanel').style.display = 'block';
  clearAuthAlerts();
}

function showMainApp(){
  ['landingPage','authPage','userDashboardPage'].forEach(id=>{ document.getElementById(id).style.display='none'; });
  document.getElementById('mainApp').style.display='block';
  const sess = getSession();
  if(sess){
    document.getElementById('nama').value         = sess.nama || '';
    document.getElementById('jenisKelamin').value = sess.jenis_kelamin || '';
    document.getElementById('headerUserName').textContent = sess.nama ? sess.nama.split(' ')[0] : '—';
  }
  initDate();
  updateStepperUI();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function showUserDashboard(){
  ['landingPage','authPage','mainApp'].forEach(id=>{ document.getElementById(id).style.display='none'; });
  document.getElementById('userDashboardPage').style.display='block';
  const sess = getSession();
  if(sess){
    document.getElementById('dashUserName').textContent  = sess.nama || '—';
    document.getElementById('dashUserNik').textContent   = sess.nik  || '—';
    document.getElementById('dashHeaderName').textContent= sess.nama ? sess.nama.split(' ')[0] : '—';
  }
  window.scrollTo({top:0,behavior:'smooth'});
  await loadUserRegistration();
}

async function onCtaClick(){
  if(!isLoggedIn()){ showAuthPage(); return; }
  // Check if user already has a registration
  showLoading('Memeriksa data...','Mengambil status pendaftaran...');
  try {
    const sess = getSession();
    const res  = await postToServer({ action:'getUserRegistration', nik: sess.nik });
    hideLoading();
    if(res.ok && res.found){
      // Already has registration — show dashboard
      showUserDashboard();
    } else {
      showMainApp();
    }
  } catch(e){
    hideLoading();
    showMainApp();
  }
}

function goToDashboard(){
  document.getElementById('successOverlay').classList.remove('show');
  showUserDashboard();
}

function backToLanding(){
  if(currentStep>1){ goStep(currentStep-1); return; }
  showLanding();
}

function goToRegistration(){
  showMainApp();
}

function updateLandingUserBar(){
  const sess = getSession();
  const bar  = document.getElementById('userLoggedBar');
  if(sess){
    bar.classList.add('show');
    document.getElementById('landingUserName').textContent = sess.nama;
    document.getElementById('landingUserNik').textContent  = 'NIK: '+sess.nik;
  } else {
    bar.classList.remove('show');
  }
  updateCtaButtonsState();
}

/* ══════════════════════════════════════════════
   CTA BUTTON STATE
   Tombol utama landing page berubah label & ikon:
   - Belum login / belum pernah daftar → "Mulai Pendaftaran BAP"
   - Sudah login & sudah mendaftar     → "Lihat Pendaftaran Saya"
   (perilaku onClick tetap onCtaClick(), yang sudah otomatis
   mengarahkan ke halaman yang tepat)
══════════════════════════════════════════════ */
const ICON_DAFTAR = '<svg class="cta-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M10 14L21 3M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6"/></svg>';
const ICON_LIHAT  = '<svg class="cta-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

async function updateCtaButtonsState(){
  const buttons = document.querySelectorAll('#landingPage .cta-primary');
  if(!buttons.length) return;
  const sess = getSession();

  const setState = (hasRegistration) => {
    buttons.forEach(btn=>{
      const label = btn.querySelector('.cta-label');
      const icon  = btn.querySelector('.cta-icon');
      if(label) label.textContent = hasRegistration ? 'Lihat Pendaftaran Saya' : 'Mulai Pendaftaran BAP';
      if(icon)  icon.outerHTML = hasRegistration ? ICON_LIHAT : ICON_DAFTAR;
    });
  };

  if(!sess){ setState(false); return; }

  try{
    const res = await postToServer({ action:'getUserRegistration', nik: sess.nik });
    setState(!!(res.ok && res.found));
  }catch(e){
    setState(false);
  }
}

function doLogout(){
  if(!confirm('Yakin ingin keluar?')) return;
  clearSession();
  currentRegData = null;
  updateLandingUserBar();
  showLanding();
}

/* ══════════════════════════════════════════════
   AUTH HELPERS
══════════════════════════════════════════════ */
function clearAuthAlerts(){
  ['loginAlert','registerAlert'].forEach(id=>{ document.getElementById(id).className='auth-alert'; });
}
function showAuthAlert(panelId,type,msg){
  const el=document.getElementById(panelId+'Alert');
  document.getElementById(panelId+'AlertMsg').textContent=msg;
  document.getElementById(panelId+'AlertIcon').textContent=type==='error'?'⚠️':'✅';
  el.className='auth-alert '+type+' show';
  el.scrollIntoView({behavior:'smooth',block:'center'});
}
function setAuthInput(id,hasError){
  const el=document.getElementById(id);
  if(!el) return;
  if(hasError) el.classList.add('err'); else el.classList.remove('err');
}

/* ══════════════════════════════════════════════
   REGISTER / LOGIN
══════════════════════════════════════════════ */
async function doRegister(){
  const nama=document.getElementById('regNama').value.trim();
  const nik=document.getElementById('regNik').value.trim();
  const tglLahir=document.getElementById('regTglLahir').value;
  const jk=document.getElementById('regJK').value;
  const password=document.getElementById('regPassword').value;
  let ok=true;
  const setE=(id,errId,cond)=>{ setAuthInput(id,!cond); document.getElementById(errId).className='auth-err'+(cond?'':' show'); if(!cond) ok=false; };
  setE('regNama','err-regNama',nama.length>=3);
  setE('regNik','err-regNik',nik.length===16&&/^\d+$/.test(nik));
  setE('regTglLahir','err-regTglLahir',tglLahir!=='');
  setE('regJK','err-regJK',jk!=='');
  setE('regPassword','err-regPassword',password.length>=6);
  if(!ok) return;
  const btn=document.getElementById('btnRegister');
  btn.disabled=true;
  showLoading('Mendaftarkan akun...','Menyimpan data ke server...');
  try{
    const res=await postToServer({action:'register',nama,nik,tanggal_lahir:tglLahir,jenis_kelamin:jk,password});
    hideLoading();
    if(!res.ok){ showAuthAlert('register','error',res.error||'Pendaftaran gagal.'); btn.disabled=false; return; }
    showAuthAlert('register','success','Akun berhasil dibuat! Silakan login.');
    setTimeout(()=>showLogin(),1500);
  } catch(e){
    hideLoading();
    showAuthAlert('register','error','Gagal terhubung ke server. Cek koneksi internet Anda.');
  }
  btn.disabled=false;
}

async function doLogin(){
  const nik=document.getElementById('loginNik').value.trim();
  const password=document.getElementById('loginPassword').value;
  let ok=true;
  const setE=(id,errId,cond)=>{ setAuthInput(id,!cond); document.getElementById(errId).className='auth-err'+(cond?'':' show'); if(!cond) ok=false; };
  setE('loginNik','err-loginNik',nik.length===16);
  setE('loginPassword','err-loginPassword',password.length>=1);
  if(!ok) return;
  const btn=document.getElementById('btnLogin');
  btn.disabled=true;
  showLoading('Memverifikasi...','Memeriksa kredensial...');
  try{
    const res=await postToServer({action:'login',nik,password});
    hideLoading();
    if(!res.ok){ showAuthAlert('login','error',res.error||'Login gagal.'); btn.disabled=false; return; }
    setSession(res.user);
    updateLandingUserBar();
    // Check if already has registration
    const regRes = await fetch(APPS_SCRIPT_URL+'?action=getUserRegistration&nik='+encodeURIComponent(nik));
    const regJson = await regRes.json();
    if(regJson.ok && regJson.found){
      showUserDashboard();
    } else {
      showMainApp();
    }
  } catch(e){
    hideLoading();
    showAuthAlert('login','error','Gagal terhubung ke server. Cek koneksi internet Anda.');
  }
  btn.disabled=false;
}

/* ══════════════════════════════════════════════
   USER DASHBOARD — Load Registration
══════════════════════════════════════════════ */
async function loadUserRegistration(){
  const sess = getSession();
  if(!sess) return;
  document.getElementById('dashLoadingState').style.display = 'block';
  document.getElementById('dashContent').style.display = 'none';
  try {
    const res = await fetch(APPS_SCRIPT_URL+'?action=getUserRegistration&nik='+encodeURIComponent(sess.nik));
    const json = await res.json();
    document.getElementById('dashLoadingState').style.display = 'none';
    document.getElementById('dashContent').style.display = 'block';
    if(json.ok && json.found){
      currentRegData = json.data;
      renderRegCard(json.data);
    } else {
      document.getElementById('noRegState').style.display = 'block';
      document.getElementById('regCardContainer').innerHTML = '';
    }
  } catch(e){
    document.getElementById('dashLoadingState').style.display = 'none';
    document.getElementById('dashContent').style.display = 'block';
    document.getElementById('regCardContainer').innerHTML = '<div style="padding:16px;text-align:center;color:var(--red-2);font-size:13px;">Gagal memuat data. Periksa koneksi internet Anda.</div>';
  }
}

function renderRegCard(data){
  const container = document.getElementById('regCardContainer');
  document.getElementById('noRegState').style.display = 'none';

  const status      = data.status || 'Menunggu';
  const rsStatus    = data.reschedule_status || '';
  const rsCount     = parseInt(data.reschedule_count || '0');

  // Status badge class
  const statusMap = {
    'Menunggu':          's-menunggu',
    'Dikonfirmasi':      's-dikonfirmasi',
    'Selesai':           's-selesai',
    'Pending Reschedule':'s-pending-rs',
  };
  const badgeClass = statusMap[status] || 's-menunggu';

  // Status dot label
  const statusLabel = status;

  // Format tanggal
  const tglFormatted = data.tanggal ? (() => {
    try {
      const d = new Date(data.tanggal+'T00:00:00');
      return d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    } catch(e){ return data.tanggal; }
  })() : '-';

  // Reschedule status block
  let rsBlock = '';
  if(rsStatus === 'Pending'){
    const rsTglFmt = data.reschedule_tanggal ? (() => {
      try {
        const d = new Date(data.reschedule_tanggal+'T00:00:00');
        return d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      } catch(e){ return data.reschedule_tanggal; }
    })() : '-';
    rsBlock = `
      <div class="reschedule-status-box rs-pending">
        <div class="rs-icon">⏳</div>
        <div>
          <div class="rs-title">Permintaan Reschedule Sedang Diproses</div>
          <div class="rs-desc">Petugas sedang meninjau permintaan Anda. Jadwal saat ini masih berlaku hingga disetujui.</div>
          <div class="rs-new-sched" style="color:#C2410C;">Jadwal Baru: ${rsTglFmt}, ${data.reschedule_jam||'-'}</div>
        </div>
      </div>`;
  } else if(rsStatus === 'Disetujui'){
    rsBlock = `
      <div class="reschedule-status-box rs-approved">
        <div class="rs-icon">✅</div>
        <div>
          <div class="rs-title">Reschedule Disetujui!</div>
          <div class="rs-desc">Jadwal Anda telah diperbarui oleh petugas. Hadir sesuai jadwal baru.</div>
        </div>
      </div>`;
  } else if(rsStatus === 'Ditolak'){
    rsBlock = `
      <div class="reschedule-status-box rs-rejected">
        <div class="rs-icon">❌</div>
        <div>
          <div class="rs-title">Permintaan Reschedule Ditolak</div>
          <div class="rs-desc">Jadwal lama tetap berlaku. Hadir sesuai jadwal yang telah ditetapkan.</div>
        </div>
      </div>`;
  }

  // Info tanggal foto ulang paspor — diisi admin saat menandai BAP "Selesai"
  // (field: foto_ulang_tanggal, format YYYY-MM-DD, sama seperti di admin BAP Online).
  let fotoUlangBlock = '';
  const tglFotoUlangRaw = data.foto_ulang_tanggal || '';
  if(status === 'Selesai' && tglFotoUlangRaw){
    const tglFotoUlangFmt = (() => {
      try {
        const d = new Date(tglFotoUlangRaw+'T00:00:00');
        return d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      } catch(e){ return tglFotoUlangRaw; }
    })();
    fotoUlangBlock = `
      <div class="foto-ulang-box">
        <div class="fu-icon">📷</div>
        <div>
          <div class="fu-title">Jadwal Foto Ulang Paspor</div>
          <div class="fu-date">${tglFotoUlangFmt}</div>
        </div>
      </div>`;
  }

  // Can reschedule?
  const canReschedule = rsCount < 1 && status !== 'Selesai' && rsStatus !== 'Pending' && rsStatus !== 'Disetujui';
  const rsDisabledReason = rsCount >= 1 ? 'Batas reschedule tercapai (maks. 1x)' :
    status === 'Selesai' ? 'Pemeriksaan sudah selesai' :
    rsStatus === 'Pending' ? 'Menunggu persetujuan' :
    rsStatus === 'Disetujui' ? 'Sudah pernah disetujui' : '';

  const rsBtn = canReschedule
    ? `<button class="btn-action btn-reschedule" onclick="openRescheduleModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Ajukan Reschedule
       </button>`
    : `<button class="btn-action btn-reschedule" disabled title="${rsDisabledReason}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Reschedule ${rsDisabledReason?'('+rsDisabledReason+')':''}
       </button>`;

  container.innerHTML = `
    <div class="reg-card">
      <div class="reg-card-header">
        <div class="reg-card-title">${data.no_registrasi || '—'}</div>
        <div class="status-badge ${badgeClass}">
          <div class="badge-dot"></div>
          ${statusLabel}
        </div>
      </div>
      ${rsBlock}
      ${fotoUlangBlock}
      <div class="reg-card-body">
        <div class="reg-row"><span class="reg-key">Nama</span><span class="reg-val">${data.nama||'—'}</span></div>
        <div class="reg-row"><span class="reg-key">Jenis Permohonan</span><span class="reg-val">${data.jenis_permohonan||'—'}</span></div>
        <div class="reg-row"><span class="reg-key">Jenis Paspor</span><span class="reg-val">${data.jenis_paspor||'—'}</span></div>
        <div class="reg-row"><span class="reg-key">Tanggal BAP</span><span class="reg-val">${tglFormatted}</span></div>
        <div class="reg-row"><span class="reg-key">Sesi</span><span class="reg-val">${data.jam||'—'}</span></div>
        <div class="reg-row"><span class="reg-key">No. HP</span><span class="reg-val">${data.hp||'—'}</span></div>
        <div class="reg-row"><span class="reg-key">Waktu Daftar</span><span class="reg-val">${data.waktu_daftar||'—'}</span></div>
        ${rsCount > 0 ? `<div class="reg-row"><span class="reg-key">Reschedule</span><span class="reg-val">${rsCount}x digunakan</span></div>` : ''}
      </div>
      <div class="reg-card-actions">
        ${rsBtn}
        <button class="btn-action btn-dl-receipt" onclick="downloadBuktiPDFFromDash()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download Bukti
        </button>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════
   RESCHEDULE MODAL
══════════════════════════════════════════════ */
function openRescheduleModal(){
  rsSelectedSlot = null;
  document.getElementById('rsTanggal').value = '';
  document.getElementById('rsAlasan').value  = '';
  document.getElementById('rsSlotArea').innerHTML = '<div class="slot-loading" style="padding:16px"><p style="color:var(--gray-4)">Silakan pilih tanggal terlebih dahulu</p></div>';
  ['err-rsTanggal','err-rsSlot','err-rsAlasan'].forEach(id=>{ document.getElementById(id).classList.remove('show'); });

  // Show current schedule
  if(currentRegData){
    const tglFmt = currentRegData.tanggal ? (() => {
      try{
        const d = new Date(currentRegData.tanggal+'T00:00:00');
        return d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      }catch(e){ return currentRegData.tanggal; }
    })() : '—';
    document.getElementById('rsCurrentSched').textContent = tglFmt + ', ' + (currentRegData.jam||'—');
  }

  // Set min date
  const inp = document.getElementById('rsTanggal');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  while(tomorrow.getDay()===0||tomorrow.getDay()===6) tomorrow.setDate(tomorrow.getDate()+1);
  inp.min = tomorrow.toISOString().split('T')[0];

  document.getElementById('rescheduleModal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeRescheduleModal(){
  document.getElementById('rescheduleModal').classList.remove('show');
  document.body.style.overflow = '';
}

async function onRsDateChange(){
  const dateStr = document.getElementById('rsTanggal').value;
  rsSelectedSlot = null;
  document.getElementById('err-rsSlot').classList.remove('show');
  if(!dateStr){ return; }
  const day = new Date(dateStr+'T00:00:00').getDay();
  if(day===0||day===6){
    document.getElementById('rsSlotArea').innerHTML = '<div class="slot-loading" style="padding:16px;background:#FFF5F5;"><p style="color:#DC2626;">❌ Tidak ada layanan pada Sabtu & Minggu</p></div>';
    return;
  }
  // Load slots
  document.getElementById('rsSlotArea').innerHTML = '<div class="slot-loading" style="padding:16px;"><div class="mini-spin" style="margin:0 auto 8px;"></div><p>Mengecek ketersediaan slot...</p></div>';
  if(!slotCacheFetched[dateStr]){
    try{
      const res  = await fetch(APPS_SCRIPT_URL+'?action=getSlots&date='+dateStr);
      const json = await res.json();
      if(json.slots) Object.entries(json.slots).forEach(([id,count])=>{ slotBookingCache[dateStr+':'+id]=count; });
    }catch(e){ console.warn('Gagal fetch slot:',e); }
    slotCacheFetched[dateStr] = true;
  }
  renderRsSlotCards(dateStr);
}

function renderRsSlotCards(dateStr){
  const area = document.getElementById('rsSlotArea');
  const now = new Date(), todayStr = now.toISOString().split('T')[0];
  const isToday = dateStr===todayStr, nowHour = now.getHours()+now.getMinutes()/60;
  const html = SLOT_DEFS.map(s=>{
    const booked = slotBookingCache[dateStr+':'+s.id]||0;
    const avail  = MAX_SLOTS-booked;
    const isPast = isToday&&nowHour>=s.end;
    const isFull = avail<=0&&!isPast;
    let cls = 'slot-card'+(isPast?' disabled':isFull?' full':'');
    let badge = isPast?'<div class="slot-badge sb-past">Selesai</div>':isFull?'<div class="slot-badge sb-full">Penuh</div>':'';
    let availHtml = isPast
      ?'<span class="avail-dot gray"></span><span style="color:var(--gray-3)">Sesi selesai</span>'
      :isFull
        ?'<span class="avail-dot red"></span><span style="color:#DC2626">Slot penuh</span>'
        :`<span class="avail-dot green"></span><span style="color:var(--green-2)">${avail} slot tersisa</span>`;
    const clickFn = (!isPast&&!isFull) ? `onclick="pickRsSlot(this,'${s.id}','${s.label}')"` : '';
    return `<div class="${cls}" data-id="${s.id}" ${clickFn}>${badge}<div class="slot-time">${s.label}</div><div class="slot-avail">${availHtml}</div></div>`;
  }).join('');
  area.innerHTML = `<div class="slot-grid" style="margin-top:4px;">${html}</div>`;
}

function pickRsSlot(el, id, label){
  document.querySelectorAll('#rsSlotArea .slot-card').forEach(c=>{ c.classList.remove('selected'); const sb=c.querySelector('.slot-badge.sb-sel'); if(sb) sb.remove(); });
  el.classList.add('selected');
  rsSelectedSlot = { id, time: label };
  const badge = document.createElement('div'); badge.className='slot-badge sb-sel'; badge.textContent='Dipilih'; el.appendChild(badge);
  document.getElementById('err-rsSlot').classList.remove('show');
}

async function submitReschedule(){
  const sess = getSession();
  if(!sess||!currentRegData){ alert('Sesi login habis.'); closeRescheduleModal(); return; }

  const tanggal = document.getElementById('rsTanggal').value;
  const alasan  = document.getElementById('rsAlasan').value.trim();

  // Validate
  let ok = true;
  if(!tanggal){ document.getElementById('err-rsTanggal').classList.add('show'); ok=false; } else { document.getElementById('err-rsTanggal').classList.remove('show'); }
  if(!rsSelectedSlot){ document.getElementById('err-rsSlot').classList.add('show'); ok=false; } else { document.getElementById('err-rsSlot').classList.remove('show'); }
  if(alasan.length<10){ document.getElementById('err-rsAlasan').classList.add('show'); ok=false; } else { document.getElementById('err-rsAlasan').classList.remove('show'); }
  if(!ok) return;

  const btn = document.getElementById('btnRsSubmit');
  btn.disabled = true;

  showLoading('Mengirim Permintaan...','Menyimpan data reschedule...');
  closeRescheduleModal();

  try {
    const res = await postToServer({
      action:               'requestReschedule',
      nik:                  sess.nik,
      rowIndex:             currentRegData._rowIndex,
      reschedule_tanggal:   tanggal,
      reschedule_jam:       rsSelectedSlot.time,
      reschedule_slot_id:   rsSelectedSlot.id,
      reschedule_alasan:    alasan,
    });
    hideLoading();
    if(!res.ok){ alert('❌ '+(res.error||'Gagal mengirim permintaan reschedule.')); btn.disabled=false; return; }

    // Show toast
    const toast = document.getElementById('rsSuccessToast');
    toast.classList.add('show');
    setTimeout(()=>{ toast.classList.remove('show'); }, 3500);

    // Refresh dashboard
    await loadUserRegistration();
  } catch(e){
    hideLoading();
    alert('Gagal terhubung ke server. Coba lagi.');
  }
  btn.disabled = false;
}

/* Close modal on backdrop click */
document.getElementById('rescheduleModal').addEventListener('click', function(e){
  if(e.target === this) closeRescheduleModal();
});

/* ══════════════════════════════════════════════
   LOADING
══════════════════════════════════════════════ */
function showLoading(title,status){
  document.getElementById('loadingTitle').textContent  = title||'Memproses...';
  document.getElementById('loadingStatus').textContent = status||'';
  document.getElementById('loadingOverlay').classList.add('show');
}
function hideLoading(){ document.getElementById('loadingOverlay').classList.remove('show'); }
function setStatus(msg){ document.getElementById('loadingStatus').textContent=msg; }

/* ══════════════════════════════════════════════
   SERVER HELPER
══════════════════════════════════════════════ */
async function postToServer(payload){
  const res = await fetch(APPS_SCRIPT_URL,{
    method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(payload),
  });
  return await res.json();
}

/* ══════════════════════════════════════════════
   FORM NAVIGATION
══════════════════════════════════════════════ */
function goStep(n){
  if(n>currentStep && !validateStep(currentStep)) return;
  currentStep=n;
  updateStepperUI();
  window.scrollTo({top:0,behavior:'smooth'});
}
function updateStepperUI(){
  document.querySelectorAll('[data-step]').forEach(el=>{
    const isActive=parseInt(el.dataset.step)===currentStep;
    el.style.display=isActive?'block':'none';
    if(isActive){ el.style.animation='none'; el.offsetHeight; el.style.animation=''; }
  });
  for(let i=1;i<=4;i++){
    const sc=document.getElementById('sc'+i);
    const sl=document.getElementById('sl'+i);
    sc.className='stp-circle'; sl.className='stp-label';
    if(i<currentStep)      { sc.classList.add('done');   sc.innerHTML='✓'; sl.classList.add('done'); }
    else if(i===currentStep){ sc.classList.add('active'); sc.innerHTML=i;   sl.classList.add('active'); }
    else                    { sc.innerHTML=i; }
  }
  for(let i=1;i<=3;i++) document.getElementById('line'+i).className='stp-line'+(i<currentStep?' done':'');
  if(currentStep===4) fillSummary();
}

/* ══════════════════════════════════════════════
   VALIDATION
══════════════════════════════════════════════ */
function validateStep(step){
  let ok=true;
  const setE=(id,errId,cond)=>{
    const el=document.getElementById(id), em=document.getElementById(errId);
    if(!cond){ el.classList.add('err'); em.classList.add('show'); ok=false; }
    else      { el.classList.remove('err'); em.classList.remove('show'); }
  };
  if(step===1){
    setE('nama','err-nama',document.getElementById('nama').value.trim().length>=3);
    setE('tempatLahir','err-tempatLahir',document.getElementById('tempatLahir').value.trim().length>=2);
    setE('tanggalLahir','err-tanggalLahir',document.getElementById('tanggalLahir').value!=='');
    setE('jenisKelamin','err-jenisKelamin',document.getElementById('jenisKelamin').value!=='');
    setE('hp','err-hp',document.getElementById('hp').value.trim().length>=8);
    setE('jenisPermohonan','err-jenis_permohonan',document.getElementById('jenisPermohonan').value!=='');
    setE('jenisPaspor','err-jenis_paspor',document.getElementById('jenisPaspor').value!=='');
    setE('tujuan','err-tujuan',document.getElementById('tujuan').value.trim().length>=5);
  }
  if(step===2){
    if(!selectedSlot){ document.getElementById('err-slot').classList.add('show'); ok=false; }
    else             { document.getElementById('err-slot').classList.remove('show'); }
  }
  if(step===3){
    if(activeUploads>0){ alert('Mohon tunggu hingga semua upload selesai.'); return false; }
    const jenis=document.getElementById('jenisPermohonan').value;
    const chkUp=(key,errId,boxId)=>{
      if(!uploadedFiles[key]){ document.getElementById(errId).classList.add('show'); document.getElementById(boxId).classList.add('error-border'); ok=false; }
      else { document.getElementById(errId).classList.remove('show'); document.getElementById(boxId).classList.remove('error-border'); }
    };
    chkUp('ktp','err-ktp','up-ktp');
    chkUp('kk','err-kk','up-kk');
    chkUp('akta','err-akta','up-akta');
    if(jenis==='BAP Paspor Rusak')   chkUp('fotoPaspor','err-fotoPaspor','up-fotoPaspor');
    if(jenis==='BAP Perubahan Data') chkUp('suratPemerintah','err-suratPemerintah','up-suratPemerintah');
    if(jenis==='BAP Paspor Hilang'){
      const jsr=document.getElementById('jenisSuratHilang').value;
      if(!jsr){
        document.getElementById('err-jenisSuratHilang').classList.add('show');
        document.getElementById('jenisSuratHilang').classList.add('err');
        ok=false;
      } else {
        document.getElementById('err-jenisSuratHilang').classList.remove('show');
        document.getElementById('jenisSuratHilang').classList.remove('err');
        if(jsr==='polisi')    chkUp('suratPolisi','err-suratPolisi','up-suratPolisi');
        if(jsr==='kelurahan') chkUp('suratKelurahan','err-suratKelurahan','up-suratKelurahan');
      }
    }
  }
  if(!ok){ const first=document.querySelector('.err, .err-msg.show, .error-border'); if(first) first.scrollIntoView({behavior:'smooth',block:'center'}); }
  return ok;
}

function onJenisChange(){
  const val=document.getElementById('jenisPermohonan').value;
  document.getElementById('grp-rusak').style.display     = val==='BAP Paspor Rusak'   ?'block':'none';
  document.getElementById('grp-hilang').style.display    = val==='BAP Paspor Hilang'  ?'block':'none';
  document.getElementById('grp-perubahan').style.display = val==='BAP Perubahan Data' ?'block':'none';
  uploadedFiles.fotoPaspor=uploadedFiles.suratPolisi=uploadedFiles.suratKelurahan=uploadedFiles.suratPemerintah=null;
}
function renderSuratHilang(){
  const val=document.getElementById('jenisSuratHilang').value;
  document.getElementById('wrap-suratPolisi').style.display    = val==='polisi'    ?'block':'none';
  document.getElementById('wrap-suratKelurahan').style.display = val==='kelurahan' ?'block':'none';
  uploadedFiles.suratPolisi=uploadedFiles.suratKelurahan=null;
}

/* ══════════════════════════════════════════════
   SLOT PICKER
══════════════════════════════════════════════ */
function initDate(){
  const inp=document.getElementById('tanggal');
  const today=new Date();
  const next=new Date(today);
  next.setDate(next.getDate()+1);
  while(next.getDay()===0||next.getDay()===6) next.setDate(next.getDate()+1);
  const fmt=d=>d.toISOString().split('T')[0];
  inp.min=fmt(today); inp.value=fmt(next);
  loadAndRenderSlots();
}
function onDateChange(){ selectedSlot=null; document.getElementById('err-slot').classList.remove('show'); loadAndRenderSlots(); }
async function loadAndRenderSlots(){
  const dateStr=document.getElementById('tanggal').value;
  const area=document.getElementById('slotArea');
  if(!dateStr){ area.innerHTML='<div class="slot-loading"><p>Silakan pilih tanggal</p></div>'; return; }
  const day=new Date(dateStr+'T00:00:00').getDay();
  if(day===0||day===6){ area.innerHTML='<div class="slot-loading" style="border-color:rgba(220,38,38,0.3);background:#FFF5F5;"><p style="color:#DC2626;">❌ Tidak ada layanan pada Sabtu &amp; Minggu</p></div>'; return; }
  if(!slotCacheFetched[dateStr]){
    area.innerHTML='<div class="slot-loading"><div class="mini-spin"></div><p>Mengecek ketersediaan slot...</p></div>';
    try{
      const res=await fetch(APPS_SCRIPT_URL+'?action=getSlots&date='+dateStr);
      const json=await res.json();
      if(json.slots) Object.entries(json.slots).forEach(([id,count])=>{ slotBookingCache[dateStr+':'+id]=count; });
    }catch(e){ console.warn('Gagal fetch slot:',e); }
    slotCacheFetched[dateStr]=true;
  }
  renderSlotCards(dateStr);
}
function renderSlotCards(dateStr){
  const area=document.getElementById('slotArea');
  const now=new Date(), todayStr=now.toISOString().split('T')[0];
  const isToday=dateStr===todayStr, nowHour=now.getHours()+now.getMinutes()/60;
  const html=SLOT_DEFS.map(s=>{
    const booked=slotBookingCache[dateStr+':'+s.id]||0;
    const avail=MAX_SLOTS-booked;
    const isPast=isToday&&nowHour>=s.end;
    const isFull=avail<=0&&!isPast;
    let cls='slot-card'+(isPast?' disabled':isFull?' full':'');
    let badge=isPast?'<div class="slot-badge sb-past">Selesai</div>':isFull?'<div class="slot-badge sb-full">Penuh</div>':'';
    let availHtml=isPast
      ?'<span class="avail-dot gray"></span><span style="color:var(--gray-3)">Sesi selesai</span>'
      :isFull
        ?'<span class="avail-dot red"></span><span style="color:#DC2626">Slot penuh</span>'
        :`<span class="avail-dot green"></span><span style="color:var(--green-2)">${avail} slot tersisa</span>`;
    const clickFn=(!isPast&&!isFull)?`onclick="pickSlot(this,'${s.id}','${s.label}')"`:'' ;
    return `<div class="${cls}" data-id="${s.id}" ${clickFn}>${badge}<div class="slot-time">${s.label}</div><div class="slot-avail">${availHtml}</div></div>`;
  }).join('');
  area.innerHTML=`<div class="slot-grid">${html}</div>`;
}
function pickSlot(el,id,label){
  document.querySelectorAll('.slot-card').forEach(c=>{ c.classList.remove('selected'); const sb=c.querySelector('.slot-badge.sb-sel'); if(sb) sb.remove(); });
  el.classList.add('selected');
  selectedSlot={id,time:label};
  const badge=document.createElement('div'); badge.className='slot-badge sb-sel'; badge.textContent='Dipilih'; el.appendChild(badge);
  document.getElementById('err-slot').classList.remove('show');
}

/* ══════════════════════════════════════════════
   UPLOAD SYSTEM
══════════════════════════════════════════════ */
function compressImage(file, maxWidth=COMPRESS_MAX_W, quality=COMPRESS_QUALITY){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        let w=img.width, h=img.height;
        if(w>maxWidth){ h=Math.round(h*(maxWidth/w)); w=maxWidth; }
        const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
        canvas.toBlob((blob)=>{ if(!blob){ reject(new Error('Gagal compress gambar')); return; } resolve(blob); }, 'image/jpeg', quality);
      };
      img.onerror=()=>reject(new Error('Gagal membaca gambar'));
      img.src=e.target.result;
    };
    reader.onerror=()=>reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

function showFilePreview(key, file, objectUrl){
  const previewEl=document.getElementById('preview-'+key);
  if(!previewEl) return;
  const sizeLabel=file.size<1024*1024?(file.size/1024).toFixed(0)+' KB':(file.size/1024/1024).toFixed(1)+' MB';
  const isImage=file.type.startsWith('image/');
  previewEl.innerHTML=`
    <div class="preview-thumb-wrap">${isImage?`<img class="preview-thumb" src="${objectUrl}" alt="Preview">`:'<div class="preview-thumb-icon">📄</div>'}</div>
    <div class="preview-info">
      <div class="preview-filename">${file.name}</div>
      <div class="preview-meta">${sizeLabel} · ${file.type.split('/')[1]?.toUpperCase()||'FILE'}</div>
      <div class="preview-status"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>Upload berhasil</div>
    </div>
    <div class="preview-actions"><button class="btn-remove-file" onclick="removeFile('${key}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>Hapus</button></div>`;
  previewEl.style.display='flex';
}

function removeFile(key){
  uploadedFiles[key]=null;
  const boxEl=document.getElementById('up-'+key);
  const triggerEl=document.getElementById('trigger-'+key);
  const progEl=document.getElementById('prog-'+key);
  const previewEl=document.getElementById('preview-'+key);
  const fileInput=document.getElementById('file-'+key);
  if(boxEl) boxEl.classList.remove('done','uploading','error-border');
  if(triggerEl) triggerEl.style.display='flex';
  if(progEl) progEl.style.display='none';
  if(previewEl){ previewEl.style.display='none'; previewEl.innerHTML=''; }
  if(fileInput) fileInput.value='';
}

function showFileAlert(key,msg){
  const el=document.getElementById('filealert-'+key);
  if(!el) return;
  el.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;color:#991B1B;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${msg}</span>`;
  el.classList.add('show');
  setTimeout(()=>{ el.classList.remove('show'); }, 5000);
}

function animateProgressBar(key){
  const fill=document.getElementById('progfill-'+key);
  if(!fill) return;
  let w=20; fill.style.width=w+'%';
  const iv=setInterval(()=>{ if(w>=85){ clearInterval(iv); return; } w+=Math.random()*8; fill.style.width=Math.min(w,85)+'%'; }, 300);
  return iv;
}

async function handleFileNew(input, key){
  const file=input.files[0];
  if(!file) return;
  const boxEl=document.getElementById('up-'+key);
  const triggerEl=document.getElementById('trigger-'+key);
  const progEl=document.getElementById('prog-'+key);
  const previewEl=document.getElementById('preview-'+key);
  const errEl=document.getElementById('err-'+key);
  const alertEl=document.getElementById('filealert-'+key);
  if(alertEl) alertEl.classList.remove('show');
  if(errEl)   errEl.classList.remove('show');
  if(boxEl)   boxEl.classList.remove('error-border');
  const allowed=['image/jpeg','image/jpg','image/png'];
  if(!allowed.includes(file.type)){ showFileAlert(key,'Format tidak didukung. Gunakan JPG atau PNG.'); input.value=''; return; }
  if(file.size>MAX_FILE_SIZE){ showFileAlert(key,`Ukuran file terlalu besar (maks. 10MB). File ini: ${(file.size/1024/1024).toFixed(1)}MB`); input.value=''; return; }
  activeUploads++;
  setUploadNavButtons(false);
  boxEl.classList.add('uploading');
  boxEl.classList.remove('done');
  if(triggerEl) triggerEl.style.display='none';
  if(progEl)    progEl.style.display='block';
  if(previewEl){ previewEl.style.display='none'; previewEl.innerHTML=''; }
  const progInterval=animateProgressBar(key);
  try{
    let uploadBlob;
    try{ uploadBlob=await compressImage(file); }catch(e){ console.warn('Compress gagal:', e); uploadBlob=file; }
    const previewUrl=URL.createObjectURL(file);
    const cloudUrl=await uploadToCloudinary(uploadBlob, file.name);
    clearInterval(progInterval);
    const fill=document.getElementById('progfill-'+key);
    if(fill) fill.style.width='100%';
    await new Promise(r=>setTimeout(r,300));
    uploadedFiles[key]={ fileName: file.name, url: cloudUrl };
    boxEl.classList.remove('uploading');
    boxEl.classList.add('done');
    if(progEl) progEl.style.display='none';
    showFilePreview(key, file, previewUrl);
  }catch(err){
    clearInterval(progInterval);
    console.error('Upload error:', err);
    boxEl.classList.remove('uploading','done');
    if(triggerEl) triggerEl.style.display='flex';
    if(progEl)    progEl.style.display='none';
    input.value='';
    showFileAlert(key,'Upload gagal. Periksa koneksi internet Anda dan coba lagi.');
  }finally{
    activeUploads=Math.max(0,activeUploads-1);
    if(activeUploads===0) setUploadNavButtons(true);
  }
}

function setUploadNavButtons(enabled){
  const b3=document.getElementById('btnBack3'), b4=document.getElementById('btnNext3');
  if(b3) b3.disabled=!enabled;
  if(b4) b4.disabled=!enabled;
}

async function uploadToCloudinary(blob, originalName){
  const fd=new FormData();
  const uploadFile=blob instanceof File?blob:new File([blob],(originalName||'dokumen')+'.jpg',{type:'image/jpeg'});
  fd.append('file', uploadFile);
  fd.append('upload_preset', UPLOAD_PRESET);
  const res=await fetch(CLOUDINARY_URL,{method:'POST',body:fd});
  if(!res.ok) throw new Error('Cloudinary HTTP '+res.status);
  const d=await res.json();
  if(d.error) throw new Error(d.error.message);
  return d.secure_url;
}

/* ══════════════════════════════════════════════
   SUMMARY
══════════════════════════════════════════════ */
function fillSummary(){
  const sess=getSession();
  const set=(id,val)=>{ const el=document.getElementById(id); el.textContent=val||'(belum diisi)'; el.className=val?'sum-val':'sum-val empty'; };
  set('sum-nik',sess?sess.nik:'—');
  set('sum-nama',document.getElementById('nama').value.trim());
  const tmpat=document.getElementById('tempatLahir').value.trim();
  const tgl  =document.getElementById('tanggalLahir').value;
  let ttl='';
  if(tmpat&&tgl){ const d=new Date(tgl+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}); ttl=tmpat+', '+d; }
  set('sum-ttl',ttl);
  set('sum-jk',              document.getElementById('jenisKelamin').value);
  set('sum-hp',              document.getElementById('hp').value.trim());
  set('sum-jenis_permohonan',document.getElementById('jenisPermohonan').value);
  set('sum-jenis_paspor',    document.getElementById('jenisPaspor').value);
  let jadwal='';
  if(selectedSlot&&document.getElementById('tanggal').value){
    const d=new Date(document.getElementById('tanggal').value+'T00:00:00');
    jadwal=d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+', '+selectedSlot.time;
  }
  set('sum-jadwal',jadwal);
  const dok=[];
  if(uploadedFiles.ktp)             dok.push('E-KTP');
  if(uploadedFiles.kk)              dok.push('KK');
  if(uploadedFiles.akta)            dok.push('Akta/Ijazah/Buku Nikah');
  if(uploadedFiles.fotoPaspor)      dok.push('Foto Paspor Rusak');
  if(uploadedFiles.suratPolisi)     dok.push('Surat Ket. Polisi');
  if(uploadedFiles.suratKelurahan)  dok.push('Surat Ket. Kelurahan');
  if(uploadedFiles.suratPemerintah) dok.push('Surat dari Pemerintah');
  if(uploadedFiles.pendukung)       dok.push('Dok. Pendukung');
  set('sum-dok',dok.join(', '));
}

async function submitForm(){
  const sess=getSession();
  if(!sess){ alert('Sesi login habis. Silakan login kembali.'); showAuthPage(); return; }
  const btnSubmit=document.getElementById('btnSubmit');
  btnSubmit.disabled=true;
  try{
    showLoading('Mengirim Pendaftaran...','Menyiapkan data...');
    const tgl=document.getElementById('tanggalLahir').value;
    const tglStr=tgl?new Date(tgl+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):'-';
    const tmpat=document.getElementById('tempatLahir').value.trim();
    const ttl=tmpat&&tgl?tmpat+', '+tglStr:tmpat||tglStr;
    let jadwal='-';
    if(selectedSlot&&document.getElementById('tanggal').value){
      const d=new Date(document.getElementById('tanggal').value+'T00:00:00');
      jadwal=d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+', '+selectedSlot.time+' WIB';
    }
    const dok=[];
    if(uploadedFiles.ktp)             dok.push('E-KTP');
    if(uploadedFiles.kk)              dok.push('KK');
    if(uploadedFiles.akta)            dok.push('Akta/Ijazah/Buku Nikah');
    if(uploadedFiles.fotoPaspor)      dok.push('Foto Paspor Rusak');
    if(uploadedFiles.suratPolisi)     dok.push('Surat Ket. Polisi');
    if(uploadedFiles.suratKelurahan)  dok.push('Surat Ket. Kelurahan');
    if(uploadedFiles.suratPemerintah) dok.push('Surat dari Pemerintah');
    if(uploadedFiles.pendukung)       dok.push('Dok. Pendukung');
    registrationData={
      nama:            document.getElementById('nama').value.trim(),
      nik:             sess.nik,
      tempatLahir:     tmpat,
      tanggalLahir:    tglStr,
      ttl, jadwal,
      jk:              document.getElementById('jenisKelamin').value,
      hp:              document.getElementById('hp').value.trim(),
      jenisPermohonan: document.getElementById('jenisPermohonan').value,
      jenisPaspor:     document.getElementById('jenisPaspor').value,
      tujuan:          document.getElementById('tujuan').value.trim(),
      dokumen:         dok.join(', ')||'-',
      waktuDaftar:     new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})+' WIB',
    };
    setStatus('Mengirim ke server...');
    const payload={
      nik:                   sess.nik,
      nama:                  registrationData.nama,
      ttl,
      jk:                    registrationData.jk,
      hp:                    registrationData.hp,
      jenis_permohonan:      registrationData.jenisPermohonan,
      jenis_paspor:          registrationData.jenisPaspor,
      tujuan:                registrationData.tujuan,
      tanggal:               document.getElementById('tanggal').value,
      jam:                   selectedSlot?.time,
      slot_id:               selectedSlot?.id,
      url_ktp:               uploadedFiles.ktp?.url              || null,
      url_kk:                uploadedFiles.kk?.url               || null,
      url_akta:              uploadedFiles.akta?.url             || null,
      url_foto_paspor:       uploadedFiles.fotoPaspor?.url       || null,
      url_surat_polisi:      uploadedFiles.suratPolisi?.url      || null,
      url_surat_kelurahan:   uploadedFiles.suratKelurahan?.url   || null,
      url_surat_pemerintah:  uploadedFiles.suratPemerintah?.url  || null,
      url_pendukung:         uploadedFiles.pendukung?.url        || null,
    };
    const serverJson=await postToServer(payload);
    setStatus('Memproses konfirmasi...');
    if(!serverJson.ok){
      hideLoading();
      btnSubmit.disabled=false;
      alert('❌ '+(serverJson.error||'Pendaftaran ditolak oleh server.'));
      return;
    }
    const code=serverJson.no_registrasi||('BAP-'+Date.now().toString().slice(-6));
    registrationData.nomorRegistrasi=code;
    const key=document.getElementById('tanggal').value+':'+selectedSlot.id;
    slotBookingCache[key]=(slotBookingCache[key]||0)+1;
    hideLoading();
    document.getElementById('regCode').textContent=code;
    document.getElementById('successOverlay').classList.add('show');
  }catch(e){
    console.error(e);
    hideLoading();
    btnSubmit.disabled=false;
    alert('Gagal mengirim data. Periksa koneksi internet Anda dan coba lagi.');
  }
}

async function downloadBuktiPDF(){
  await generatePDF(registrationData);
}

async function downloadBuktiPDFFromDash(){
  if(!currentRegData) return;

  const rsStatus = currentRegData.reschedule_status || '';
  const fmtTgl = (tgl) => {
    if(!tgl) return '-';
    try{ return new Date(tgl+'T00:00:00').toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
    catch(e){ return tgl; }
  };

  // Jadwal yang berlaku resmi: jika reschedule sudah Disetujui, pakai jadwal baru.
  // Jika masih Pending, jadwal LAMA tetap yang berlaku sampai disetujui petugas.
  let jadwalAktifTgl = currentRegData.tanggal;
  let jadwalAktifJam = currentRegData.jam;
  if(rsStatus === 'Disetujui' && currentRegData.reschedule_tanggal){
    jadwalAktifTgl = currentRegData.reschedule_tanggal;
    jadwalAktifJam = currentRegData.reschedule_jam;
  }

  // ── FIX BUG: jadwal LAMA yang benar untuk PDF ──
  // Setelah reschedule Disetujui, kolom tanggal/jam di sheet SUDAH ditimpa
  // menjadi jadwal baru oleh Apps Script (approveReschedule). Jadi untuk
  // menampilkan "Jadwal Semula" yang benar, kita HARUS ambil dari kolom
  // tanggal_lama/jam_lama (kolom baru yang disimpan sebelum di-overwrite),
  // bukan dari tanggal/jam yang sudah berubah.
  // Kalau masih Pending, kolom tanggal/jam memang masih yang lama (belum disentuh).
  let tanggalLamaVal = currentRegData.tanggal;
  let jamLamaVal      = currentRegData.jam;
  if(rsStatus === 'Disetujui'){
    tanggalLamaVal = currentRegData.tanggal_lama || currentRegData.tanggal;
    jamLamaVal      = currentRegData.jam_lama      || currentRegData.jam;
  }

  const d = {
    nomorRegistrasi: currentRegData.no_registrasi,
    nama:            currentRegData.nama,
    nik:             currentRegData.nik,
    ttl:             currentRegData.ttl,
    jk:              currentRegData.jk,
    hp:              currentRegData.hp,
    jenisPermohonan: currentRegData.jenis_permohonan,
    jenisPaspor:     currentRegData.jenis_paspor,
    tujuan:          currentRegData.tujuan,
    dokumen:         'Dokumen telah diupload',
    jadwal:          fmtTgl(jadwalAktifTgl)+', '+(jadwalAktifJam||'-')+' WIB',
    waktuDaftar:     currentRegData.waktu_daftar,
    reschedule: rsStatus ? {
      status:       rsStatus,
      tanggalLama:  fmtTgl(tanggalLamaVal)+', '+(jamLamaVal||'-')+' WIB',
      tanggalBaru:  fmtTgl(currentRegData.reschedule_tanggal)+', '+(currentRegData.reschedule_jam||'-')+' WIB',
      alasan:       currentRegData.reschedule_alasan || '-',
    } : null,
    fotoUlang: (currentRegData.status === 'Selesai' && currentRegData.foto_ulang_tanggal)
      ? fmtTgl(currentRegData.foto_ulang_tanggal)
      : null,
  };
  await generatePDF(d);
}

async function generatePDF(d){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210, H=297, margin=18, contentW=W-margin*2;

  // Warna netral, satu accent color saja (biru instansi)
  const ink      = [30,41,59];      // teks utama
  const sub      = [100,116,139];   // teks sekunder / label
  const accent   = [3,105,161];     // biru instansi
  const line     = [226,232,240];   // garis pemisah tipis
  const softBg   = [248,250,252];   // latar section abu sangat muda

  let y = margin;

  // ── Kop surat sederhana ──
  doc.setTextColor(...ink); doc.setFont('helvetica','bold'); doc.setFontSize(12.5);
  doc.text('KANTOR IMIGRASI KELAS I TPI TANJUNGPINANG',margin,y);
  y += 5.5;
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...sub);
  doc.text('Kementerian Imigrasi dan Kemasyarakatan · Intelijen dan Penindakan Keimigrasian',margin,y);
  y += 7;
  doc.setDrawColor(...accent); doc.setLineWidth(0.8);
  doc.line(margin,y,margin+contentW,y);
  y += 10;

  // ── Judul dokumen ──
  doc.setTextColor(...ink); doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text('Bukti Pendaftaran BAP',margin,y);
  y += 6;
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...sub);
  doc.text('Layanan BAP Online — Kantor Imigrasi Kelas I TPI Tanjungpinang',margin,y);
  y += 9;

  // ── Nomor registrasi ──
  doc.setFillColor(...softBg);
  doc.rect(margin,y,contentW,16,'F');
  doc.setDrawColor(...line); doc.setLineWidth(0.3);
  doc.rect(margin,y,contentW,16,'S');
  doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...sub);
  doc.text('NOMOR REGISTRASI',margin+6,y+6.5);
  doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...accent);
  doc.text(d.nomorRegistrasi||'—',margin+6,y+12.5);
  y += 24;

  // ── Helper: judul section ──
  const sectionTitle = (label) => {
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...accent);
    doc.text(label.toUpperCase(),margin,y);
    y += 4;
    doc.setDrawColor(...line); doc.setLineWidth(0.3);
    doc.line(margin,y,margin+contentW,y);
    y += 6;
  };

  // ── Helper: baris label–nilai (dua kolom sejajar rapi) ──
  const labelColW = 52;
  const row = (label,value) => {
    const lines = doc.splitTextToSize(String(value||'-'),contentW-labelColW);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...sub);
    doc.text(label,margin,y+3.5);
    doc.setFont('helvetica','bold'); doc.setTextColor(...ink);
    doc.text(lines,margin+labelColW,y+3.5);
    y += Math.max(6.5, lines.length*4.2 + 2.3);
  };

  sectionTitle('Data Diri Pemohon');
  row('NIK', d.nik);
  row('Nama Lengkap', d.nama);
  row('Tempat / Tgl Lahir', d.ttl);
  row('Jenis Kelamin', d.jk);
  row('No. HP / WhatsApp', d.hp);
  y += 4;

  sectionTitle('Detail Permohonan');
  row('Jenis Permohonan', d.jenisPermohonan);
  row('Jenis Paspor', d.jenisPaspor);
  row('Tujuan Pembuatan', d.tujuan);
  y += 4;

  sectionTitle('Jadwal Kedatangan');
  row('Tanggal & Sesi BAP', d.jadwal);
  if(d.fotoUlang){ row('Jadwal Foto Ulang Paspor', d.fotoUlang); }
  y += 4;

  // ── Blok reschedule (hanya jika pernah mengajukan) ──
  if(d.reschedule){
    const rs = d.reschedule;
    const rsLabel = { 'Pending':'Menunggu persetujuan petugas', 'Disetujui':'Disetujui petugas', 'Ditolak':'Ditolak petugas' }[rs.status] || rs.status;

    sectionTitle('Informasi Reschedule');
    row('Status', rsLabel);
    row('Jadwal Semula', rs.tanggalLama);
    row('Jadwal Diajukan', rs.tanggalBaru);
    row('Alasan', rs.alasan);
    y += 4;
  }

  sectionTitle('Dokumen Dilampirkan');
  const dokLines = doc.splitTextToSize(d.dokumen||'-', contentW);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...ink);
  doc.text(dokLines,margin,y+3.5);
  y += dokLines.length*4.2 + 8;

  // ── Catatan penting ──
  const noteLines = doc.splitTextToSize(
    'Pemohon wajib membawa berkas asli sesuai persyaratan saat datang ke kantor, hadir tepat waktu, dan menunggu konfirmasi petugas via WhatsApp sebelum datang.',
    contentW-10
  );
  const noteH = noteLines.length*4.2 + 10;
  doc.setFillColor(...softBg);
  doc.rect(margin,y,contentW,noteH,'F');
  doc.setDrawColor(...accent); doc.setLineWidth(0.6);
  doc.line(margin,y,margin,y+noteH); // aksen garis kiri tipis
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...ink);
  doc.text('Catatan Penting',margin+6,y+6);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...sub);
  doc.text(noteLines,margin+6,y+11);
  y += noteH + 8;

  // ── Footer ──
  doc.setDrawColor(...line); doc.setLineWidth(0.3);
  doc.line(margin,H-20,margin+contentW,H-20);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...sub);
  doc.text('Waktu pendaftaran: '+(d.waktuDaftar||'-'),margin,H-14);
  doc.text('BAP Online · Kantor Imigrasi Kelas I TPI Tanjungpinang',margin,H-9.5);
  doc.text('Dokumen ini dihasilkan otomatis oleh sistem dan sah tanpa tanda tangan basah.',margin,H-5);

  doc.save('Bukti_BAP_'+(d.nomorRegistrasi||'Pendaftaran')+'.pdf');
}

function resetAll(){ document.getElementById('successOverlay').classList.remove('show'); location.reload(); }

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
updateLandingUserBar();
updateStepperUI();
