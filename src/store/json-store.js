const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.files = {
      batches: 'batches.json',
      receipts: 'receipts.json',
      receivables: 'receivables.json',
      claims: 'claims.json',
      hangings: 'hangings.json',
      exports: 'exports.json',
      seq: 'seq.json'
    };
    this._ensureDir();
    this._initFiles();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _initFiles() {
    Object.values(this.files).forEach(f => {
      const fp = path.join(this.dataDir, f);
      if (!fs.existsSync(fp)) {
        const initData = f === 'seq.json' ? {} : [];
        fs.writeFileSync(fp, JSON.stringify(initData, null, 2));
      }
    });
  }

  _read(file) {
    const fp = path.join(this.dataDir, file);
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw || '[]');
  }

  _write(file, data) {
    const fp = path.join(this.dataDir, file);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  }

  _getSeq(key) {
    const fp = path.join(this.dataDir, this.files.seq);
    const seq = JSON.parse(fs.readFileSync(fp, 'utf-8') || '{}');
    seq[key] = (seq[key] || 0) + 1;
    fs.writeFileSync(fp, JSON.stringify(seq, null, 2));
    return seq[key];
  }

  nextId(prefix) {
    const num = this._getSeq(prefix);
    const pad = String(num).padStart(6, '0');
    return `${prefix}${Date.now().toString().slice(-6)}${pad}`;
  }

  getAll(key) {
    return this._read(this.files[key]);
  }

  saveAll(key, list) {
    this._write(this.files[key], list);
  }

  insert(key, record) {
    const list = this.getAll(key);
    list.push(record);
    this.saveAll(key, list);
    return record;
  }

  update(key, id, data, idField = 'id') {
    const list = this.getAll(key);
    const idx = list.findIndex(r => r[idField] === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data };
    this.saveAll(key, list);
    return list[idx];
  }

  findById(key, id, idField = 'id') {
    return this.getAll(key).find(r => r[idField] === id);
  }

  filter(key, predicate) {
    return this.getAll(key).filter(predicate);
  }
}

module.exports = JsonStore;
