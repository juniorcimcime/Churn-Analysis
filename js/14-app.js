// ---------------- UI wiring ----------------

els.fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) {
    selectedFile = f;
    els.fileLabel.textContent = `${f.name}  (${(f.size / 1e6).toFixed(1)} MB)`;
    els.scanBtn.disabled = false;
  }
});

els.resetBtn.addEventListener('click', () => {
  selectedFile = null;
  state = null;
  els.fileInput.value = '';
  els.fileLabel.textContent = 'henüz dosya seçilmedi';
  els.scanBtn.disabled = true;
  hideAllVisuals();
  els.filterSection.style.display = 'none';
  els.emptyState.style.display = 'block';
  els.emptyState.textContent = 'Henüz bir tarama yapılmadı. Yukarıdan CSV dosyanı seç ve "1. Dosyayı Tara"ya bas.';
  clearLog();
  els.progressWrap.style.display = 'none';
  els.cookingWrap.style.display = 'none';
});

els.scanBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  runScan(selectedFile).catch((err) => {
    logLine('HATA: ' + err.message);
    console.error(err);
    els.scanBtn.disabled = false;
    els.cookingWrap.style.display = 'none';
  });
});

els.applyFilterBtn.addEventListener('click', () => {
  if (!state) return;
  try {
    runFilteredAnalysis();
  } catch (err) {
    logLine('HATA: ' + err.message);
    console.error(err);
  }
});

// ---------------- sekme gecisi ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.style.display = panel.id === target ? 'block' : 'none';
    });
  });
});

function hideAllVisuals() {
  els.statsSection.style.display = 'none';
  els.visual1.style.display = 'none';
  els.visual3.style.display = 'none';
  els.visual4.style.display = 'none';
  els.visual1Grid.innerHTML = '';
  els.visual3Holder.innerHTML = '';
  els.visual4Grid.innerHTML = '';
  els.scatterGrid.innerHTML = '';
  els.day2CancelGrid.innerHTML = '';
  ['gf1Grid', 'gf2Grid', 'gf3Grid', 'gf4Grid', 'gf5Grid', 'adv1Grid', 'adv2Grid',
   'cs1Grid', 'cs2Grid', 'cs3Grid', 'cs5Grid', 'cs6Grid', 'cs7Grid', 'cs7RevGrid', 'cs8Grid', 'cs9Grid', 'cs10Grid', 'nsImpliedGrid', 'ns0Grid', 'ns1Grid', 'ns2Grid', 'ns3Grid', 'ns4Grid', 'ns5Grid', 'gf6Grid', 'gf7Grid', 'cs11Grid', 'cs12Grid', 'imgRenewalGrid',
  ].forEach((k) => { if (els[k]) els[k].innerHTML = ''; });
}

function clearLog() {
  els.log.style.display = 'none';
  els.log.textContent = '';
}

function logLine(msg) {
  els.log.style.display = 'block';
  els.log.textContent += msg + '\n';
  els.log.scrollTop = els.log.scrollHeight;
}

function setProgress(pct, label) {
  els.progressWrap.style.display = 'block';
  els.progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  els.progressLabel.textContent = label;
}

