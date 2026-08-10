/**
 * Sending a catalogue row to the scene studio, and getting a picture back.
 *
 * The catalogue studio makes a product's own images: the shelf on a white
 * cyclorama, emptied, from a couple of angles. The scene studio puts that shelf
 * in a room. A row wants both, and until now getting from one to the other meant
 * downloading an image, opening the other page, uploading it again, and typing
 * the design code back in — then doing the reverse to get the result home. Four
 * chances to file the wrong picture under the wrong shelf.
 *
 * So: a button on the row, a banner on the other page, a button to send the
 * chosen shot home. Nothing to name, nothing to download, nothing to retype.
 *
 *     catalogue row ──"Scene shots"──▶  handoff record  ──▶ /scene-studio
 *                                       (IndexedDB)
 *     catalogue row ◀──"Send to row"──  same record, now carrying the result
 *
 * **Why IndexedDB and not a URL, sessionStorage or a server round trip.** The
 * payload is a photograph — commonly a megabyte or two of data URL. A query
 * string cannot hold it; sessionStorage is a few megabytes at best and shared
 * with everything else the page keeps; and a server hop would mean uploading a
 * private image to somewhere it does not need to go. Both studios already keep
 * their sessions in IndexedDB, so this adds a store, not a concept.
 *
 * The *id* travels in the URL — it is not a secret, and a page reload has to be
 * able to find its way back to the record. It is moved into sessionStorage and
 * stripped from the address bar on arrival, so a reload keeps the banner and a
 * bookmark does not resurrect a finished handoff.
 *
 * **What a handoff carries.** The image to work from, the design code, and the
 * scale — the record *and* the photograph with the figure already composited
 * into it. That last part is only possible because both studios now measure the
 * same way (js/studio/scale.js); before, the scale would have had to be set
 * twice, by hand, and the two answers would have differed.
 *
 * **A returned shot is never dropped on the floor.** The record survives until a
 * catalogue studio with the matching row picks it up, so sending one home and
 * then closing the tab loses nothing. Records older than a week are cleared on
 * the way past, because an abandoned one is holding a photograph.
 */
(function(){
  "use strict";

  const DB_NAME = "frameworkStudioHandoff";
  const STORE = "handoffs";
  const ACTIVE_KEY = "frameworkHandoffActive";
  const URL_PARAM = "handoff";

  /** A handoff nobody collected is still holding a photograph. */
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function open(){
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: "id"});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * One store operation.
   *
   * A write resolves on `transaction.oncomplete`, **not** on the request's own
   * success. Those are different moments: the request succeeds first and the
   * transaction commits after it, and both `send` and `returnResult` navigate
   * the moment their write resolves. Resolving at the earlier point meant
   * leaving for the other page with the write still in flight, where the
   * navigation could abort it — the handoff, or the finished scene shot, simply
   * never existed. It failed perhaps one time in some, which is the worst rate
   * a bug can have.
   */
  function run(mode, method, ...args){
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = transaction.objectStore(STORE)[method](...args);
      let value;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("The handoff write was interrupted."));
    }));
  }

  function newId(){
    return `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async function put(record){
    const saved = {...record, updatedAt: Date.now()};
    await run("readwrite", "put", saved);
    return saved;
  }

  const get = id => id ? run("readonly", "get", id) : Promise.resolve(null);
  const remove = id => run("readwrite", "delete", id);
  const all = () => run("readonly", "getAll").then(rows => rows || []);

  /** Clear anything nobody came back for. Cheap, and runs on the way past. */
  async function expire(){
    const cutoff = Date.now() - MAX_AGE_MS;
    const stale = (await all()).filter(row => (row.updatedAt || row.createdAt || 0) < cutoff);
    await Promise.all(stale.map(row => remove(row.id)));
    return stale.length;
  }

  // ─── The catalogue studio's half ────────────────────────────────────

  /**
   * Write the handoff and go. The id rides in the URL because the record is far
   * too big to, and because a reload on the other side has to find it again.
   */
  async function send(record){
    await expire().catch(() => {});
    const saved = await put({
      ...record,
      id: newId(),
      createdAt: Date.now(),
      status: "open",
      result: null
    });
    window.location.href = `/scene-studio?${URL_PARAM}=${encodeURIComponent(saved.id)}`;
    return saved;
  }

  /** An unfinished session for this row, if somebody left one open. */
  async function openFor(rowId){
    if(!rowId) return null;
    const rows = await all();
    return rows
      .filter(row => row.status === "open" && row.rowId === rowId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
  }

  /** Reopen one that was left open, without writing a second record. */
  function resume(id){
    window.location.href = `/scene-studio?${URL_PARAM}=${encodeURIComponent(id)}`;
  }

  /**
   * Every finished handoff whose row this page actually has, handed over and
   * deleted. One that matches nothing is left alone — the row it belongs to may
   * be in a session that is not loaded yet, and quietly binning somebody's
   * generated image is the one outcome worth engineering against.
   */
  async function collect(hasRow){
    await expire().catch(() => {});
    const returned = (await all()).filter(row => row.status === "returned" && row.result);
    const mine = returned.filter(row => hasRow(row.rowId));
    await Promise.all(mine.map(row => remove(row.id)));
    return {collected: mine, waiting: returned.length - mine.length};
  }

  // ─── The scene studio's half ────────────────────────────────────────

  /**
   * Take the id out of the address bar and remember it for this tab.
   *
   * Same move the access gate makes with `?key=`, for the same reason: a URL
   * gets bookmarked, shared and re-opened, and none of those should re-enter a
   * handoff that is already finished.
   *
   * Returns `{id, fresh}` or null. `fresh` separates arriving from reloading,
   * which are the same id and very different instructions.
   */
  function claimFromUrl(){
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get(URL_PARAM);
    if(fromUrl){
      params.delete(URL_PARAM);
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
      try{ window.sessionStorage.setItem(ACTIVE_KEY, fromUrl); }catch(e){ /* private mode; the tab still works */ }
      return {id: fromUrl, fresh: true};
    }
    let stored = null;
    try{ stored = window.sessionStorage.getItem(ACTIVE_KEY); }catch(e){ /* nothing stored */ }
    // Not fresh: this is a reload of a page that was already working on the
    // handoff. The caller must re-attach the banner and leave the workspace
    // alone -- reloading is not a reason to throw away generated shots.
    return stored ? {id: stored, fresh: false} : null;
  }

  function forget(){
    try{ window.sessionStorage.removeItem(ACTIVE_KEY); }catch(e){ /* nothing to do */ }
  }

  /** Put the chosen image in the record and go back to the row. */
  async function returnResult(id, result, label){
    const record = await get(id);
    if(!record) throw new Error("That handoff is no longer there.");
    await put({...record, status: "returned", result, resultLabel: label || "Scene shot"});
    forget();
    window.location.href = "/catalog-studio";
  }

  window.FrameworkHandoff = {
    DB_NAME, STORE, URL_PARAM, MAX_AGE_MS,
    put, get, remove, all, expire,
    send, collect, openFor, resume,
    claimFromUrl, forget, returnResult
  };
})();
