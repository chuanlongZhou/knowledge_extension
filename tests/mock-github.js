// In-memory Git server exercising the real adapter's GitHub API protocol.
export class MockGitHub {
  constructor() { this.root = '/repos/test-owner/knowledge'; this.private = true; this.blobs = new Map(); this.trees = new Map(); this.commits = new Map(); this.refs = new Map(); this.calls = []; this.counter = 0; }
  sha() { return (++this.counter).toString(16).padStart(40, '0'); }
  get head() { return this.refs.get('main') || null; }
  files(commit = this.head) { return new Map(commit ? this.trees.get(this.commits.get(commit).tree) : []); }
  json(path, commit = this.head) { const sha = this.files(commit).get(path); return sha ? JSON.parse(this.blobs.get(sha)) : null; }
  async fetch(url, options = {}) {
    const u = new URL(url), path = decodeURIComponent(u.pathname), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    this.calls.push({path, method, body, accept: options.headers.Accept});
    if (options.headers.Authorization !== 'Bearer fake-token-only-for-tests') return Response.json({message: 'Unauthorized'}, {status: 401});
    if (this.failNext && (!this.failNext.method || this.failNext.method === method)) { const fail = this.failNext; this.failNext = null; return Response.json({message: 'Injected failure'}, {status: fail.status || 503}); }
    const route = path.slice(this.root.length);
    if (path === this.root) return Response.json({private: this.private, default_branch: 'main'});
    if (method === 'GET' && route.startsWith('/git/ref/heads/')) { const branch = route.slice('/git/ref/heads/'.length); return this.refs.has(branch) ? Response.json({object: {sha: this.refs.get(branch)}}) : Response.json({}, {status: 404}); }
    if (method === 'GET' && route.startsWith('/git/matching-refs/heads/')) return Response.json([...this.refs].map(([key, sha]) => ({ref: `refs/heads/${key}`, object: {sha}})));
    if (method === 'GET' && route.startsWith('/git/commits/')) { const commit = this.commits.get(route.slice('/git/commits/'.length)); return commit ? Response.json({tree: {sha: commit.tree}, parents: commit.parents.map(sha => ({sha}))}) : Response.json({}, {status: 404}); }
    if (method === 'GET' && route.startsWith('/contents/')) { const file = route.slice('/contents/'.length);const sha=this.files(u.searchParams.get('ref')||this.head).get(file);if(!sha)return Response.json({}, {status:404});const stored=this.blobs.get(sha);return typeof stored==='string'?Response.json(JSON.parse(stored)):new Response(stored,{headers:{'Content-Type':'application/octet-stream'}}); }
    if (method === 'GET' && route.startsWith('/git/trees/')) { const tree = this.trees.get(route.slice('/git/trees/'.length)); return tree ? Response.json({truncated: false, tree: [...tree].map(([path, sha]) => ({path, sha, type: 'blob'}))}) : Response.json({}, {status: 404}); }
    if (method === 'POST' && route === '/git/blobs') { const sha = this.sha(); this.blobs.set(sha, body.encoding==='base64'?Buffer.from(body.content,'base64'):body.content); return Response.json({sha}, {status: 201}); }
    if (method === 'POST' && route === '/git/trees') {
      const files = new Map(body.base_tree ? this.trees.get(body.base_tree) : []);
      for (const item of body.tree) { if (item.sha === null) files.delete(item.path); else { if (!this.blobs.has(item.sha)) throw new Error('Missing blob'); files.set(item.path, item.sha); } }
      const sha = this.sha(); this.trees.set(sha, files); return Response.json({sha}, {status: 201});
    }
    if (method === 'POST' && route === '/git/commits') { const sha = this.sha(); this.commits.set(sha, {tree: body.tree, parents: body.parents}); return Response.json({sha}, {status: 201}); }
    if ((method === 'PATCH' && route.startsWith('/git/refs/heads/')) || (method === 'POST' && route === '/git/refs')) {
      if (this.beforeUpdate) { const fn = this.beforeUpdate; this.beforeUpdate = null; await fn(); }
      const branch = method === 'PATCH' ? route.slice('/git/refs/heads/'.length) : body.ref.slice('refs/heads/'.length);
      const previous = this.refs.get(branch), next = this.commits.get(body.sha);
      if (body.force) throw new Error('Force pushes are forbidden');
      if ((method === 'POST' && previous) || (previous && previous !== body.sha && !this.isAncestor(previous, body.sha))) return Response.json({message: 'Not fast forward'}, {status: 409});
      if (!next) throw new Error('Missing commit');
      this.refs.set(branch, body.sha);
      if (this.loseUpdateResponse) { this.loseUpdateResponse = false; throw new TypeError('Connection lost after commit'); }
      return Response.json({object: {sha: body.sha}});
    }
    throw new Error(`Unexpected mock endpoint: ${method} ${path}`);
  }
  isAncestor(ancestor, descendant) { const stack = [descendant], seen = new Set(); while (stack.length) { const sha = stack.pop(); if (sha === ancestor) return true; if (seen.has(sha)) continue; seen.add(sha); stack.push(...(this.commits.get(sha)?.parents || [])); } return false; }
  externalWrite(path, data) {
    const files = this.files(), blob = this.sha(); this.blobs.set(blob, JSON.stringify(data)); files.set(path, blob);
    const tree = this.sha(); this.trees.set(tree, files); const commit = this.sha(); this.commits.set(commit, {tree, parents: this.head ? [this.head] : []}); this.refs.set('main', commit); return commit;
  }
}
