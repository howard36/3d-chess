MoveHistory alone with N moves; appends one and times the commit (flushSync) and a forced layout after it (run 20261011-0531, ledger R115b).
Copy probe-landing.html to client/ and probeLanding.tsx to client/src/dev/, run `npx vite --port 5199` in client/, then `N=2000 node run.mjs 5199 <label>`. Development React: compare runs with each other only.
Result on the branch (f3a7969): commit 4.6 / 3.7 / 5.9 / 7.2 ms at N = 100 / 500 / 2000 / 4000; skipping the layout read or every block memo check changed nothing.
