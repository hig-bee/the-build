/* Rooms, notes, and triage.
   Kept out of index.html for two reasons: this logic can be tested on its own in
   tests.html, and a new room should be a row in a table rather than a new branch
   threaded through the app. */
(function (global) {
  "use strict";

  /* The shape a save is written with. Nothing reads it yet: migrate() rebuilds
     fields rather than branching on a number. Raising this to 2 therefore means
     writing the migration that reads it first — bump the number on its own and
     v1 data gets relabelled v2 without ever being touched. */
  const STORE_VERSION = 1;

  /* The build this file belongs to. index.html refuses to run against a
     rooms.js from another build (an old saved copy on the phone) — the two must
     always move together, and publish.ps1 checks they do. */
  const BUILD = 33;

  /* One row per room. The home tiles, the triage buttons and the word matcher all
     read this table, so adding Finance later means adding a row and a screen —
     not editing five places.
     `cadence` comes from the architecture spec. It is recorded now and unused
     until that room goes live.
     The word lists for rooms that are not live are a first draft; tune them when
     that room is actually built. */
  /* Tints, build 31: six clearly separate hues — ember, gold, turquoise, blue,
     rose, violet — so no two rooms read as shades of one colour on the dark
     ground. Inside a room the tint is an accent only (its icon square and pills);
     the panels stay neutral, so a room never turns monochrome. `icon` (emoji) is
     kept for anything that still reads it; the app draws line icons by room id. */
  const ROOMS = [
    {
      id: "fitness",
      label: "Fitness",
      icon: "🏃",
      tint: "#e0603f",
      live: true,
      cadence: "Weekly (active training block)",
      words: [
        "run", "runs", "ran", "running", "jog", "jogged", "mile", "miles", "pace",
        "splits", "marathon", "race", "taper", "deload", "shakeout", "tempo",
        "interval", "intervals", "gym", "lift", "lifted", "lifting", "squat",
        "squats", "deadlift", "rdl", "lunge", "lunges", "plank", "strength",
        "calf", "calves", "knee", "knees", "hamstring", "quad", "quads",
        "achilles", "shin", "shins", "stretch", "stretching", "shoes", "insoles",
        "gels", "hydration", "electrolytes", "cramp", "cramped", "blister",
        "blisters", "workout", "cardio", "treadmill", "strava", "garmin"
      ]
    },
    {
      id: "finance",
      label: "Finance",
      icon: "💰",
      tint: "#e3b53a",
      live: true,
      cadence: "Biweekly light check, monthly deep dive",
      words: [
        "budget", "budgeting", "spend", "spending", "invest", "investing", "401k",
        "roth", "savings", "expense", "expenses", "bill", "bills", "tax", "taxes",
        "refinance", "insurance", "salary", "raise", "bonus", "mortgage"
      ]
    },
    {
      id: "living",
      label: "Living",
      icon: "🌴",
      tint: "#2fb5b0",
      live: true,
      cadence: "Whenever something good comes up - weekends and trips",
      /* No "brunch", "pool" or "park": each collides with an everyday sentence
         that belongs somewhere else, and a wrong suggestion is worse than none. */
      words: [
        "travel", "traveling", "trip", "trips", "vacation", "flight", "flights",
        "hotel", "airbnb", "beach", "hike", "hiking", "camping", "kayak",
        "kayaking", "fishing", "boat", "boating", "cruise", "resort", "island",
        "snorkel", "snorkeling", "restaurant", "restaurants", "food", "foodie",
        "dinner", "brewery", "winery", "wine", "cigar", "cigars", "concert",
        "festival", "museum", "weekend", "getaway", "adventure", "explore",
        "golf", "reservation", "reservations", "sunset"
      ]
    },
    {
      /* The id stays "maintenance" whatever the label says: screen ids are built
         as <roomid>-screen, and a room id must never change once notes can be
         promoted into it. */
      id: "maintenance",
      label: "Maintenance",
      /* Not a house: the house belongs to the Today button in the bottom bar. */
      icon: "🔧",
      tint: "#5d86e0",
      live: true,
      cadence: "Event-driven, plus recurring upkeep jobs",
      words: [
        "pool", "resurfacing", "heater", "hvac", "furnace", "roof", "gutter",
        "gutters", "plumber", "electrician", "vendor", "warranty", "repair",
        "repairs", "contractor", "filter", "filters", "garage", "driveway",
        "thermostat", "chiller", "plunge", "hose", "hoses", "pump", "leak",
        "leaking", "maintenance"
      ]
    },
    {
      id: "family",
      label: "Family",
      icon: "❤️",
      tint: "#cc5a95",
      live: false,
      cadence: "No fixed clock",
      words: [
        "mom", "dad", "brother", "sister", "birthday", "anniversary", "gift",
        "gifts", "thanksgiving", "christmas", "wedding", "nephew", "niece",
        "grandma", "grandpa"
      ]
    },
    {
      id: "career",
      label: "Career",
      icon: "📈",
      tint: "#9775dc",
      live: false,
      cadence: "Monthly, or timed around review cycles",
      words: [
        "resume", "idp", "promotion", "manager", "interview", "certification",
        "cert", "linkedin", "recruiter", "offer", "conference", "mentor"
      ]
    }
  ];

  function roomById(id) {
    return ROOMS.filter(function (r) { return r.id === id; })[0] || null;
  }

  function liveRooms() {
    return ROOMS.filter(function (r) { return r.live; });
  }

  /* The only place a routing decision is made in the whole app. Swapping this
     body for a Claude API call changes nothing else: the triage card, the
     promotion and the counts all depend only on the signature
     suggestRoom(text) -> roomId | null.

     Whole words only, so "brunch" never counts as "run". Rooms that are not live
     are skipped, so their draft word lists cannot produce a suggestion for a room
     that does not exist yet. Ties go to the earlier room in the table. */
  function suggestRoom(text) {
    const seen = {};
    String(text || "").toLowerCase().split(/[^a-z0-9]+/).forEach(function (t) {
      if (t) seen[t] = true;
    });

    let best = null;
    let bestHits = 0;
    liveRooms().forEach(function (room) {
      const hits = room.words.filter(function (w) { return seen[w]; }).length;
      if (hits > bestHits) {
        best = room.id;
        bestHits = hits;
      }
    });
    return best;
  }

  /* ---------- notes ---------- */

  function makeNote(text, nowIso) {
    return {
      id: "n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      text: String(text).trim(),
      created: nowIso,
      room: null,
      triaged: false,
      promoted: null,
      tags: []
    };
  }

  function byId(notes, id) {
    return notes.filter(function (n) { return n.id === id; })[0] || null;
  }

  /* Notes are added with unshift, so a note's position in the array is its
     insertion order reversed. Two notes saved in the same millisecond carry the
     same `created`, so position is the only thing left to order them by —
     without it the sort is unstable and the same two notes swap places between
     renders. */
  function newestFirst(list) {
    return list
      .map(function (n, i) { return { note: n, at: i }; })
      .sort(function (a, b) {
        if (a.note.created !== b.note.created) return a.note.created < b.note.created ? 1 : -1;
        return a.at - b.at;
      })
      .map(function (x) { return x.note; });
  }

  /* Everything still sitting in Notes, reviewed or not. */
  function inbox(notes) {
    return newestFirst(notes.filter(function (n) { return n.room === null; }));
  }

  /* The triage queue: in Notes and never decided on. Oldest first, so the queue
     drains in the order things were dumped. A note you chose to keep in Notes is
     not asked about again. */
  function untriaged(notes) {
    return notes
      .map(function (n, i) { return { note: n, at: i }; })
      .filter(function (x) { return x.note.room === null && !x.note.triaged; })
      .sort(function (a, b) {
        if (a.note.created !== b.note.created) return a.note.created < b.note.created ? -1 : 1;
        /* Same millisecond. Newer notes sit earlier in the array, so the larger
           index is the older note and belongs first in an oldest-first queue. */
        return b.at - a.at;
      })
      .map(function (x) { return x.note; });
  }

  /* Old saves have no notes at all, and a half-written one must not take the app
     down. Every field is rebuilt rather than trusted — the same approach load()
     in index.html takes with the rest of the state.
     The dates are type-checked, not just defaulted: both are sliced to get their
     day out, and a number where a string belongs would throw inside the list
     render and take the whole Notes screen with it. */
  function migrate(savedNotes) {
    if (!Array.isArray(savedNotes)) return [];
    return savedNotes
      .filter(function (n) { return n && typeof n.text === "string"; })
      .map(function (n) {
        return {
          id: typeof n.id === "string" ? n.id : ("n-" + Math.random().toString(36).slice(2, 9)),
          text: n.text,
          created: typeof n.created === "string" ? n.created : new Date().toISOString(),
          room: typeof n.room === "string" ? n.room : null,
          triaged: Boolean(n.triaged),
          promoted: typeof n.promoted === "string" ? n.promoted : null,
          tags: Array.isArray(n.tags) ? n.tags : []
        };
      });
  }

  /* ---------- triage ---------- */

  function promote(notes, id, roomId, nowIso) {
    const n = byId(notes, id);
    if (!n) return notes;
    n.room = roomId;
    n.promoted = nowIso;
    n.triaged = true;
    return notes;
  }

  /* No clear fit. It stays in Notes and stops being asked about — it is still
     listed there, it just does not come round again on the next pass. */
  function keep(notes, id) {
    const n = byId(notes, id);
    if (n) n.triaged = true;
    return notes;
  }

  /* A wrong call is one tap to undo. The note goes back to Notes and back into
     the triage queue, so it can be decided again. */
  function sendBack(notes, id) {
    const n = byId(notes, id);
    if (!n) return notes;
    n.room = null;
    n.promoted = null;
    n.triaged = false;
    return notes;
  }

  /* The one note operation that cannot be undone, so it stays its own function
     rather than a mode of keep or sendBack. The caller confirms first. */
  function removeNote(notes, id) {
    for (let i = notes.length - 1; i >= 0; i--) {
      if (notes[i].id === id) notes.splice(i, 1);
    }
    return notes;
  }

  function forRoom(notes, roomId) {
    return newestFirst(notes.filter(function (n) { return n.room === roomId; }));
  }

  /* ---------- finance ---------- */

  /* Money only ever moves through here as integer cents. Floats drift after
     enough additions, so the boundary with what a person typed lives in this one
     function rather than being re-parsed wherever a number is needed. */
  function toCents(text) {
    if (text === null || text === undefined) return null;
    const stripped = String(text).trim().replace(/[$,\s]/g, "");
    if (stripped === "" || stripped === "-" || stripped === "+") return null;
    const n = Number(stripped);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  /* The inverse of toCents, for display. Built from integer dollars and cents
     rather than toFixed on a division, so a huge value cannot reintroduce the
     float rounding this whole module exists to avoid. */
  function formatMoney(cents) {
    const n = Number.isFinite(cents) ? cents : 0;
    const negative = n < 0;
    const abs = Math.abs(n);
    const dollars = Math.floor(abs / 100);
    const remainder = abs % 100;
    const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const centsStr = remainder < 10 ? "0" + remainder : String(remainder);
    return (negative ? "-$" : "$") + withCommas + "." + centsStr;
  }

  function makeLocation(label, opts, nowIso) {
    const o = opts || {};
    return {
      id: "loc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      label: String(label).trim(),
      value: Number.isFinite(o.value) ? o.value : 0,
      target: Number.isFinite(o.target) ? o.target : null,
      quickAdd: Number.isFinite(o.quickAdd) ? o.quickAdd : null,
      updated: nowIso
    };
  }

  function makeFinance() {
    return { workbookUrl: null, locations: [], log: [] };
  }

  function locationById(finance, id) {
    if (!finance || !Array.isArray(finance.locations)) return null;
    return finance.locations.filter(function (l) { return l.id === id; })[0] || null;
  }

  function setValue(finance, id, cents, nowIso) {
    const loc = locationById(finance, id);
    if (loc) {
      loc.value = cents;
      loc.updated = nowIso;
    }
    return finance;
  }

  /* A missing id or a zero/null amount is a no-op rather than a throw: the
     screen can fire this straight off a form without checking first, and an
     empty quick-add tap must not leave a "$0.00" line sitting in the log. */
  function contribute(finance, id, cents, nowIso) {
    const loc = locationById(finance, id);
    if (!loc || cents === 0 || cents === null || cents === undefined) return finance;
    loc.value += cents;
    loc.updated = nowIso;
    finance.log.unshift({
      id: "fl-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      locationId: id,
      amount: cents,
      at: nowIso
    });
    return finance;
  }

  /* Reads the year straight off the ISO string's first four characters rather
     than building a Date and calling getFullYear(): a Date reads back in the
     device's local time zone, which can shift a late-December contribution
     into the wrong year. */
  function contributedInYear(finance, id, year) {
    if (!finance || !Array.isArray(finance.log)) return 0;
    const y = String(year);
    return finance.log
      .filter(function (entry) {
        return entry.locationId === id &&
          typeof entry.at === "string" && entry.at.slice(0, 4) === y;
      })
      .reduce(function (sum, entry) {
        return sum + (Number.isFinite(entry.amount) ? entry.amount : 0);
      }, 0);
  }

  function totalValue(finance) {
    if (!finance || !Array.isArray(finance.locations)) return 0;
    return finance.locations.reduce(function (sum, loc) {
      return sum + (Number.isFinite(loc.value) ? loc.value : 0);
    }, 0);
  }

  /* Same defensive approach as migrate() for notes: a malformed save must not
     take the app down. A log entry survives its location being deleted — the
     trail is history — but an entry with an unusable amount cannot be summed
     into anything, so it is dropped rather than kept as a zero. */
  function migrateFinance(saved) {
    const src = (saved && typeof saved === "object") ? saved : {};
    const locations = Array.isArray(src.locations) ? src.locations : [];
    const log = Array.isArray(src.log) ? src.log : [];

    return {
      workbookUrl: typeof src.workbookUrl === "string" ? src.workbookUrl : null,
      locations: locations
        .filter(function (l) { return l && typeof l.label === "string" && Number.isFinite(l.value); })
        .map(function (l) {
          return {
            id: typeof l.id === "string" ? l.id : ("loc-" + Math.random().toString(36).slice(2, 9)),
            label: l.label.trim(),
            value: l.value,
            target: Number.isFinite(l.target) ? l.target : null,
            quickAdd: Number.isFinite(l.quickAdd) ? l.quickAdd : null,
            updated: typeof l.updated === "string" ? l.updated : new Date().toISOString()
          };
        }),
      log: log
        .filter(function (entry) { return entry && Number.isFinite(entry.amount); })
        .map(function (entry) {
          return {
            id: typeof entry.id === "string" ? entry.id : ("fl-" + Math.random().toString(36).slice(2, 9)),
            locationId: typeof entry.locationId === "string" ? entry.locationId : null,
            amount: entry.amount,
            at: typeof entry.at === "string" ? entry.at : new Date().toISOString()
          };
        })
    };
  }

  /* ---------- living ---------- */

  /* Travel, adventure, food, the good-life side. An item is a thing to do or a
     place to go, optionally dated, and eventually done ("been"). Round two adds
     where it is, a link (a map pin or a website), and an end date so a trip can
     span days — the end date is what later lets Beez know Ryan is away. */
  const LIVING_KINDS = ["Trip", "Adventure", "Food", "Local", "Leisure"];

  /* Undated items sit on one of three shelves so a long list stays findable:
     places to eat, places to go nearby, and trips to take. Kinds map onto
     shelves rather than replacing them, so no saved item changes meaning. */
  const LIVING_SHELVES = [
    { id: "food", label: "Food spots", kinds: ["Food"] },
    { id: "places", label: "Places to go", kinds: ["Local", "Adventure", "Leisure"] },
    { id: "trips", label: "Trip ideas", kinds: ["Trip"] }
  ];

  function shelfOf(kind) {
    const hit = LIVING_SHELVES.filter(function (sh) { return sh.kinds.indexOf(kind) > -1; })[0];
    return hit ? hit.id : "places";
  }

  /* Only http(s) links are kept: a javascript: or data: link in an href would
     run when tapped. new URL() also rejects garbage outright. A bare
     "example.com" is given https:// first, since that is how people paste. */
  function safeLink(text) {
    let raw = String(text || "").trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw;
    try {
      const u = new URL(raw);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.indexOf(".") > 0 ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function cleanText(value, max) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
  }

  /* An end date only means something after a start date, and never before it. */
  function cleanEnd(date, endDate) {
    return isYmd(date) && isYmd(endDate) && endDate > date ? endDate : null;
  }

  function isYmd(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function makeLiving() {
    return { items: [] };
  }

  function makeLivingItem(title, opts, nowIso) {
    const o = opts || {};
    return {
      id: "lv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      title: String(title).trim(),
      kind: LIVING_KINDS.indexOf(o.kind) > -1 ? o.kind : "Leisure",
      date: isYmd(o.date) ? o.date : null,
      endDate: cleanEnd(o.date, o.endDate),
      where: cleanText(o.where, 60),
      link: safeLink(o.link),
      done: false,
      created: nowIso
    };
  }

  /* The last day a plan covers: its end date for a trip, otherwise its date. */
  function lastDay(it) {
    return it.endDate || it.date;
  }

  function livingItemById(living, id) {
    if (!living || !Array.isArray(living.items)) return null;
    return living.items.filter(function (it) { return it.id === id; })[0] || null;
  }

  function setDone(living, id, done) {
    const it = livingItemById(living, id);
    if (it) it.done = Boolean(done);
    return living;
  }

  function removeLivingItem(living, id) {
    if (!living || !Array.isArray(living.items)) return living;
    for (let i = living.items.length - 1; i >= 0; i--) {
      if (living.items[i].id === id) living.items.splice(i, 1);
    }
    return living;
  }

  /* The three lists below partition every item exactly once: dated and ahead,
     undated, or finished-or-passed. Dates stay YYYY-MM-DD strings, which sort
     correctly as text, so a timezone can never move a plan onto another day.
     A dated plan that passes without being ticked moves to the past list rather
     than vanishing, so "did we ever go?" still has an answer. */
  function upcoming(living, todayYmd) {
    return living.items
      .filter(function (it) { return !it.done && it.date && lastDay(it) >= todayYmd; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function someday(living) {
    return newestFirst(living.items.filter(function (it) { return !it.done && !it.date; }));
  }

  /* Someday items on one shelf, newest first. */
  function onShelf(living, shelfId) {
    return someday(living).filter(function (it) { return shelfOf(it.kind) === shelfId; });
  }

  /* Days Ryan is away: every dated Trip not marked done, from its start date to
     its end date (or just the one day). Returned as {from, to} YYYY-MM-DD pairs,
     soonest first. Phase 2 (the week view) reads this. */
  function awayRanges(living) {
    return living.items
      .filter(function (it) { return !it.done && it.kind === "Trip" && it.date; })
      .map(function (it) { return { from: it.date, to: lastDay(it), id: it.id, title: it.title }; })
      .sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  }

  function pastItems(living, todayYmd) {
    return living.items
      .filter(function (it) { return it.done || (it.date && lastDay(it) < todayYmd); })
      .sort(function (a, b) {
        const ka = a.date || a.created.slice(0, 10);
        const kb = b.date || b.created.slice(0, 10);
        return ka < kb ? 1 : ka > kb ? -1 : 0;
      });
  }

  function migrateLiving(saved) {
    const src = (saved && typeof saved === "object") ? saved : {};
    const items = Array.isArray(src.items) ? src.items : [];
    return {
      items: items
        .filter(function (it) { return it && typeof it.title === "string" && it.title.trim(); })
        .map(function (it) {
          return {
            id: typeof it.id === "string" ? it.id : ("lv-" + Math.random().toString(36).slice(2, 9)),
            title: it.title.trim(),
            kind: LIVING_KINDS.indexOf(it.kind) > -1 ? it.kind : "Leisure",
            date: isYmd(it.date) ? it.date : null,
            endDate: cleanEnd(it.date, it.endDate),
            where: cleanText(it.where, 60),
            link: safeLink(it.link),
            done: Boolean(it.done),
            created: typeof it.created === "string" ? it.created : new Date().toISOString()
          };
        })
    };
  }

  /* ---------- maintenance ---------- */

  /* Recurring upkeep: a job, how often it comes round, and when it was last
     done. The next due date is worked out, never stored, so marking a job done
     is one field and an interval change can never leave a stale due date behind.
     Nothing here ever alerts: a job that comes due simply sits at the top of the
     list until it is done. */
  const MAINT_INTERVALS = [
    { days: 7, label: "Every week" },
    { days: 14, label: "Every 2 weeks" },
    { days: 30, label: "Every month" },
    { days: 91, label: "Every 3 months" },
    { days: 182, label: "Every 6 months" },
    { days: 365, label: "Every year" }
  ];

  function intervalLabel(days) {
    const hit = MAINT_INTERVALS.filter(function (i) { return i.days === days; })[0];
    return hit ? hit.label : "Every " + days + " days";
  }

  function validEvery(n) {
    return Number.isInteger(n) && n > 0 && n <= 3650;
  }

  /* Plain calendar arithmetic on YYYY-MM-DD strings, done in UTC so no
     timezone or daylight-saving change can move a due date by a day. */
  function addDaysYmd(dateYmd, n) {
    const p = dateYmd.split("-");
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
    return d.toISOString().slice(0, 10);
  }

  function daysUntil(fromYmd, toYmd) {
    const a = fromYmd.split("-"), b = toYmd.split("-");
    return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
  }

  function makeMaintTask(title, opts, nowIso) {
    const o = opts || {};
    return {
      id: "mt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      title: String(title).trim(),
      every: validEvery(o.every) ? o.every : 30,
      lastDone: isYmd(o.lastDone) ? o.lastDone : nowIso.slice(0, 10),
      note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : null,
      created: nowIso
    };
  }

  /* What a brand-new Maintenance room starts with. Only used the first time the
     room is opened on a device (no saved maintenance at all) — once there is a
     saved list, even an empty one, this is never applied again, so a deleted
     job stays deleted. */
  function starterMaintenance() {
    return {
      tasks: [
        {
          id: "mt-chiller-filter",
          title: "Rinse the Ice Pod chiller filter",
          every: 14,
          lastDone: "2026-10-18",
          note: "Unplug first. Rinse the cartridge until the water runs clean, then bleed the air from the filter housing before restarting. While you're there, check the hoses for kinks. A clogged filter or a kinked hose is what causes the E2 flow error.",
          created: "2026-10-19T00:00:00.000Z"
        }
      ]
    };
  }

  function maintTaskById(maint, id) {
    if (!maint || !Array.isArray(maint.tasks)) return null;
    return maint.tasks.filter(function (t) { return t.id === id; })[0] || null;
  }

  function dueOn(task) {
    return addDaysYmd(task.lastDone, task.every);
  }

  function markMaintDone(maint, id, todayYmd) {
    const t = maintTaskById(maint, id);
    if (t && isYmd(todayYmd)) t.lastDone = todayYmd;
    return maint;
  }

  /* Undo for an accidental "Done today": puts back the date it had before. */
  function setLastDone(maint, id, dateYmd) {
    const t = maintTaskById(maint, id);
    if (t && isYmd(dateYmd)) t.lastDone = dateYmd;
    return maint;
  }

  function removeMaintTask(maint, id) {
    if (!maint || !Array.isArray(maint.tasks)) return maint;
    for (let i = maint.tasks.length - 1; i >= 0; i--) {
      if (maint.tasks[i].id === id) maint.tasks.splice(i, 1);
    }
    return maint;
  }

  /* Every job, soonest due first. Ties fall back to the title so the order never
     shuffles between renders. */
  function byDue(maint) {
    return maint.tasks.slice().sort(function (a, b) {
      const da = dueOn(a), db = dueOn(b);
      if (da !== db) return da < db ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
  }

  /* Jobs due on or before a given day — today plus a window of days ahead. */
  function dueWithin(maint, todayYmd, days) {
    const limit = addDaysYmd(todayYmd, days);
    return byDue(maint).filter(function (t) { return dueOn(t) <= limit; });
  }

  /* ---------- maintenance → the phone's calendar ---------- */

  /* Beez itself never alerts. What it can do, when Ryan taps for it, is hand a
     job to the phone's own Calendar app as a repeating event with its own
     alert — the calendar does the reminding, on his say-so, and he can delete
     the event there at any time. The file is standard iCalendar (.ics), which
     iPhone Calendar, Google Calendar and Outlook all read.

     The calendar series is fixed once added: it repeats on its own rhythm from
     the first due date and does not move if a job is done early or late. Beez
     stays the source of truth for when a job is actually next due. */

  /* What time of day the reminder lands. Evenings are when Ryan is home and
     already in the app; kept in one place so it is a one-line change. */
  const MT_CAL_TIME = "1900";      // 7:00 PM, local time wherever the phone is
  const MT_CAL_MINUTES = 15;

  /* The app counts in days; a calendar repeats in weeks, months and years.
     30 / 91 / 182 / 365 days read as "a month / 3 months / 6 months / a year",
     so they map to the calendar's own units rather than drifting a day or two
     each round. Anything else repeats every N days exactly. */
  function calRule(days) {
    if (days % 7 === 0 && days <= 28) return "FREQ=WEEKLY;INTERVAL=" + (days / 7);
    if (days === 30) return "FREQ=MONTHLY;INTERVAL=1";
    if (days === 91) return "FREQ=MONTHLY;INTERVAL=3";
    if (days === 182) return "FREQ=MONTHLY;INTERVAL=6";
    if (days === 365) return "FREQ=YEARLY;INTERVAL=1";
    return "FREQ=DAILY;INTERVAL=" + days;
  }

  /* iCalendar text rules: backslash, semicolon and comma are escaped, and line
     breaks become a literal \n. */
  function calText(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /* Lines longer than 75 characters are folded: broken, and the follow-on line
     starts with a space. Folding by character is slightly conservative for
     plain English text and keeps multi-byte characters whole. */
  function calFold(line) {
    const out = [];
    let rest = line;
    while (rest.length > 74) {
      out.push(rest.slice(0, 74));
      rest = " " + rest.slice(74);
    }
    out.push(rest);
    return out.join("\r\n");
  }

  function calStamp(nowIso) {
    return nowIso.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";
  }

  /* The first date a calendar event lands on: the job's next due date, or today
     if that date has already passed (a past start would put old alerts on the
     calendar the moment it is added). */
  function calStart(task, todayYmd) {
    const due = dueOn(task);
    return due < todayYmd ? todayYmd : due;
  }

  function calEvent(task, todayYmd, nowIso) {
    const start = calStart(task, todayYmd);
    const day = start.replace(/-/g, "");
    const endMin = Number(MT_CAL_TIME.slice(2)) + MT_CAL_MINUTES;
    const end = MT_CAL_TIME.slice(0, 2) + String(endMin).padStart(2, "0");
    let rule = calRule(task.every);
    /* A monthly series started on the 29th-31st would skip short months, so it
       lands on each month's last day instead. */
    if (rule.indexOf("FREQ=MONTHLY") === 0 && Number(start.slice(8)) > 28) rule += ";BYMONTHDAY=-1";
    const about = (task.note ? task.note + "\n\n" : "") +
      "Repeats " + intervalLabel(task.every).toLowerCase() + ". " +
      "When it's done, tap Done today in Beez → Maintenance.";
    return [
      "BEGIN:VEVENT",
      "UID:" + task.id + "@beez",
      "DTSTAMP:" + calStamp(nowIso),
      "DTSTART:" + day + "T" + MT_CAL_TIME + "00",
      "DTEND:" + day + "T" + end + "00",
      "RRULE:" + rule,
      "SUMMARY:" + calText(task.title),
      "DESCRIPTION:" + calText(about),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + calText(task.title),
      "TRIGGER:PT0M",
      "END:VALARM",
      "END:VEVENT"
    ];
  }

  /* One .ics holding one event per job given. */
  function maintCalendar(tasks, todayYmd, nowIso) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Beez//Maintenance//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    (tasks || []).forEach(function (t) {
      Array.prototype.push.apply(lines, calEvent(t, todayYmd, nowIso));
    });
    lines.push("END:VCALENDAR");
    return lines.map(calFold).join("\r\n") + "\r\n";
  }

  function migrateMaintenance(saved) {
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.tasks)) {
      return starterMaintenance();
    }
    return {
      tasks: saved.tasks
        .filter(function (t) { return t && typeof t.title === "string" && t.title.trim(); })
        .map(function (t) {
          const created = typeof t.created === "string" ? t.created : new Date().toISOString();
          return {
            id: typeof t.id === "string" ? t.id : ("mt-" + Math.random().toString(36).slice(2, 9)),
            title: t.title.trim(),
            every: validEvery(t.every) ? t.every : 30,
            lastDone: isYmd(t.lastDone) ? t.lastDone : created.slice(0, 10),
            note: typeof t.note === "string" && t.note.trim() ? t.note.trim() : null,
            created: created
          };
        })
    };
  }

  global.Rooms = {
    BUILD: BUILD,
    STORE_VERSION: STORE_VERSION,
    ROOMS: ROOMS,
    roomById: roomById,
    liveRooms: liveRooms,
    suggestRoom: suggestRoom,
    makeNote: makeNote,
    byId: byId,
    inbox: inbox,
    untriaged: untriaged,
    migrate: migrate,
    promote: promote,
    keep: keep,
    sendBack: sendBack,
    removeNote: removeNote,
    forRoom: forRoom,
    toCents: toCents,
    formatMoney: formatMoney,
    makeLocation: makeLocation,
    makeFinance: makeFinance,
    locationById: locationById,
    setValue: setValue,
    contribute: contribute,
    contributedInYear: contributedInYear,
    totalValue: totalValue,
    migrateFinance: migrateFinance,
    LIVING_KINDS: LIVING_KINDS,
    LIVING_SHELVES: LIVING_SHELVES,
    shelfOf: shelfOf,
    safeLink: safeLink,
    onShelf: onShelf,
    awayRanges: awayRanges,
    lastDay: lastDay,
    makeLiving: makeLiving,
    makeLivingItem: makeLivingItem,
    livingItemById: livingItemById,
    setDone: setDone,
    removeLivingItem: removeLivingItem,
    upcoming: upcoming,
    someday: someday,
    pastItems: pastItems,
    migrateLiving: migrateLiving,
    MAINT_INTERVALS: MAINT_INTERVALS,
    intervalLabel: intervalLabel,
    addDaysYmd: addDaysYmd,
    daysUntil: daysUntil,
    makeMaintTask: makeMaintTask,
    starterMaintenance: starterMaintenance,
    maintTaskById: maintTaskById,
    dueOn: dueOn,
    markMaintDone: markMaintDone,
    setLastDone: setLastDone,
    removeMaintTask: removeMaintTask,
    byDue: byDue,
    dueWithin: dueWithin,
    calRule: calRule,
    calStart: calStart,
    maintCalendar: maintCalendar,
    migrateMaintenance: migrateMaintenance
  };
}(window));
