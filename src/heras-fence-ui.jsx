import React, { useState, useEffect, useMemo, useRef } from "react";

export default function HerasInputMockup() {
  // ---------------- Auth ----------------
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  const normalisePin = (val) => (val || "").replace(/\D/g, "").trim();
  const validatePin = (val) => normalisePin(val) === "1234";

  const tryLogin = (e) => {
    e.preventDefault();
    if (validatePin(pin)) {
      setAuthed(true);
      try {
        window.localStorage.setItem("heras_demo_authed", "1");
      } catch {}
      setPinError("");
    } else {
      setPinError("Incorrect PIN. Try 1234 for the demo.");
    }
  };

  const logout = () => {
    setAuthed(false);
    try {
      window.localStorage.removeItem("heras_demo_authed");
    } catch {}
    setPin("");
  };

  // ---------------- State (App) ----------------
  const [form, setForm] = useState({
    projectName: "",
    postcode: "",
    duration: "< 28 days",
    ground: "Hardstanding (concrete/asphalt)",
    height: "2.0 m",
    distanceToSea: "",
    altitude: "",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [wind, setWind] = useState(null);
  const [selected, setSelected] = useState([]);

  // --- Wind helper (deterministic mock based on postcode) ---
  const computeWind = (postcode) => {
    const cleaned = (postcode || "").toUpperCase().split(" ").join("");
    const base = 22; // m/s
    const codeSum = cleaned.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0);
    const speed = Math.round(base + (codeSum % 11));
    const pressureRaw = Number((0.0005 * speed * speed).toFixed(3));
    const pressure_kpa = Math.min(pressureRaw, 0.149);
    const speed_ms = Math.round(Math.sqrt(pressure_kpa / 0.0005));
    return { speed_ms, pressure_kpa };
  };

  // ---- Geocoding & Leaflet map state ----
  const [geo, setGeo] = useState({ lat: null, lon: null, displayName: "" });
  const [geoError, setGeoError] = useState("");
  const mapEl = useRef(null);
  const [leafletMap, setLeafletMap] = useState(null);

  // Load Leaflet from CDN on demand
  const ensureLeaflet = () =>
    new Promise((resolve, reject) => {
      if (window.L) return resolve(window.L);
      const cssId = "leaflet-css";
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      const jsId = "leaflet-js";
      if (!document.getElementById(jsId)) {
        const script = document.createElement("script");
        script.id = jsId;
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.onload = () => resolve(window.L);
        script.onerror = reject;
        document.body.appendChild(script);
      } else {
        resolve(window.L);
      }
    });

  // Geocode postcode and render marker – structured search + draggable/click with reverse geocode
  useEffect(() => {
    const raw = (form.postcode || "").toString();
    const pc = raw.split(" ").join("").toUpperCase();
    if (!pc) {
      setGeo({ lat: null, lon: null, displayName: "" });
      setGeoError("");
      return;
    }
    let cancelled = false;
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=gb&limit=1&postalcode=" +
      encodeURIComponent(pc);
    setGeoError("");
    fetch(url)
      .then(function (r) {
        return r.json();
      })
      .then(async function (arr) {
        if (cancelled) return;
        if (!arr || !arr.length) {
          setGeo({ lat: null, lon: null, displayName: "" });
          setGeoError("Location not found.");
          return;
        }
        const item = arr[0];
        const nlat = parseFloat(item.lat);
        const nlon = parseFloat(item.lon);
        setGeo({ lat: nlat, lon: nlon, displayName: item.display_name || "" });
        setGeoError("");
        try {
          await ensureLeaflet();
          if (!mapEl.current) return;
          let map = leafletMap;
          if (!map) {
            map = window.L.map(mapEl.current).setView([nlat, nlon], 14);
            window.L
              .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap",
              })
              .addTo(map);
            setLeafletMap(map);
            // ensure proper rendering when container becomes visible
            setTimeout(() => { try { map.invalidateSize(); } catch(e) {} }, 0);
          } else {
            map.setView([nlat, nlon], 14);
            setTimeout(() => { try { map.invalidateSize(); } catch(e) {} }, 0);
          }

          const upsertMarker = async function (lat, lon) {
            if (map._markerLayer) map.removeLayer(map._markerLayer);
            const marker = window.L
              .marker([lat, lon], { draggable: true })
              .addTo(map);
            map._markerLayer = marker;
            marker.bindPopup((form.postcode || "").toString());
            const reverse = async function (la, lo) {
              try {
                const res = await fetch(
                  "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
                    la +
                    "&lon=" +
                    lo +
                    "&addressdetails=1"
                );
                const data = await res.json();
                const newPc = ((data && data.address && data.address.postcode) || "").toUpperCase();
                if (newPc && newPc !== form.postcode) {
                  update("postcode", newPc);
                }
              } catch (e) {}
            };
            marker.on("dragend", async function (ev) {
              const pos = ev.target.getLatLng();
              await reverse(pos.lat, pos.lng);
            });
          };

          await upsertMarker(nlat, nlon);

          if (!map._clickBound) {
            map.on("click", async function (ev) {
              const lat = ev.latlng.lat;
              const lng = ev.latlng.lng;
              await upsertMarker(lat, lng);
              try {
                const res = await fetch(
                  "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
                    lat +
                    "&lon=" +
                    lng +
                    "&addressdetails=1"
                );
                const data = await res.json();
                const newPc = ((data && data.address && data.address.postcode) || "").toUpperCase();
                if (newPc && newPc !== form.postcode) update("postcode", newPc);
              } catch (e) {}
            });
            map._clickBound = true;
          }
        } catch (e) {
          setGeoError("Could not load map library.");
        }
      })
      .catch(function () {
        setGeo({ lat: null, lon: null, displayName: "" });
        setGeoError("Could not fetch map location.");
      });

    return function () {
      cancelled = true;
    };
  }, [form.postcode]);

  // Recompute wind automatically whenever postcode changes
  useEffect(() => {
    const pc = (form.postcode || '').trim();
    if (pc) setWind(computeWind(pc));
    else setWind(null);
  }, [form.postcode]);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const validate = () => {
    const e = {};
    if (!form.projectName.trim()) e.projectName = "Project name is required.";
    if (!/^\s*[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\s*$/i.test(form.postcode.trim())) {
      e.postcode = "Enter a valid UK postcode (e.g., SW4 6QD).";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const LOGO = "https://browne.co.uk/wp-content/themes/browne/images/logo_footer.jpg";
  const IMG1 = "https://i.ibb.co/LzMWRbqj/IMG1-fence-1.jpg";
  const IMG2 = "https://i.ibb.co/Kc61kkHd/IMG2-fence-2.jpg";
  const IMG3 = "https://i.ibb.co/VYkkBwWW/IMG3-fence-3.jpg";
  const IMG4 = "https://i.ibb.co/pBCs5YHd/IMG4-fence-4.jpg";

  const options = useMemo(
    () => [
      { id: "A", name: "2.0 m panels @ 3.5 m centres", capacity_kpa: 0.1, maxHeight_m: 2.0, img: IMG3 },
      { id: "B", name: "2.0 m panels + rear brace/ballast", capacity_kpa: 0.2, maxHeight_m: 2.0, img: IMG2 },
      { id: "C", name: "2.4 m hoarding with buttress @ 2.4 m", capacity_kpa: 0.3, maxHeight_m: 2.4, img: IMG1 },
      { id: "D", name: "2.4 m mesh with rear braces @ 2.4 m", capacity_kpa: 0.3, maxHeight_m: 2.4, img: IMG2 },
      { id: "E", name: "2.4 m hoarding + heavy ballast", capacity_kpa: 0.4, maxHeight_m: 2.4, img: IMG1 },
      { id: "F", name: "3.0 m hoarding with twin buttress", capacity_kpa: 0.5, maxHeight_m: 3.0, img: IMG4 },
    ],
    []
  );

  const requiredHeight_m = useMemo(() => parseFloat(form.height), [form.height]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    setWind(computeWind(form.postcode));
    setSubmitted(true);
    setSelected([]);
  };

  const optionDisabled = (o) => {
    if (!wind) return true;
    const heightTooShort = requiredHeight_m > o.maxHeight_m;
    const overCapacity = wind.pressure_kpa > o.capacity_kpa;
    return heightTooShort || overCapacity;
  };

  const toggleSelect = (id, disabled) => {
    if (disabled) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <>
      <div className="sticky top-0 z-40 mb-6 w-full border-b bg-white/95 backdrop-blur px-4 py-2">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="text-sm font-semibold" style={{ color: "#003A5D" }}>
            MWP Engineering
          </div>
          <div className="flex items-center gap-3">
            {authed && (
              <button
                onClick={logout}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs shadow-sm hover:bg-gray-50"
              >
                Logout
              </button>
            )}
            <img src={LOGO} alt="Browne" className="h-16 w-auto" />
          </div>
        </div>
      </div>

      {!authed ? (
        <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center p-6">
          <form onSubmit={tryLogin} className="w-full rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="mb-2 text-xl font-semibold">Browne access</h1>
            <p className="mb-4 text-sm text-gray-600">
              Enter PIN to continue. Demo PIN: <span className="font-mono">1234</span>.
            </p>
            <label className="mb-1 block text-sm font-medium">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••"
              className={`mb-2 w-full rounded-xl border p-2.5 tracking-widest focus:outline-none focus:ring ${pinError ? "border-red-500" : "border-gray-300"}`}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            {pinError && <p className="mb-2 text-xs text-red-600">{pinError}</p>}
            <button
              type="submit"
              className="mt-2 w-full rounded-xl px-4 py-2 shadow-sm"
              style={{ background: "#003A5D", color: "#fff" }}
            >
              Enter
            </button>
          </form>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">Site-Specific Heras Fencing – Quick Setup</h1>
            <p className="text-sm text-gray-600">
              Enter basic details to generate site-specific designs and a calculation pack.
            </p>
          </header>

          {/* Map moved to top */}
          <section className="rounded-2xl bg-white p-5 shadow-sm mb-6">
            <h2 className="mb-4 text-lg font-medium">Site location map</h2>
            {(form.postcode || "").trim().length > 0 ? (
              <>
                <div ref={mapEl} className="h-64 w-full rounded-lg" />
                {geoError && <div className="mt-2 text-xs text-red-600">{geoError}</div>}
                {geo.displayName && (
                  <div className="mt-2 text-xs text-gray-600">{geo.displayName}</div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500">Enter a valid UK postcode to preview the map.</div>
            )}
          </section>

          <form className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Project details */}
            <section className="lg:col-span-3 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-medium">Project details</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Project name</label>
                  <input
                    className={`w-full rounded-xl border p-2.5 focus:outline-none focus:ring ${errors.projectName ? "border-red-500" : "border-gray-300"}`}
                    placeholder="e.g., Longreach STW – Perimeter"
                    value={form.projectName}
                    onChange={(e) => update("projectName", e.target.value)}
                  />
                  {errors.projectName && (
                    <p className="mt-1 text-xs text-red-600">{errors.projectName}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Project postcode</label>
                  <input
                    className={`w-full rounded-xl border p-2.5 uppercase focus:outline-none focus:ring ${errors.postcode ? "border-red-500" : "border-gray-300"}`}
                    placeholder="SW4 6QD"
                    value={form.postcode}
                    onChange={(e) => update("postcode", e.target.value.toUpperCase())}
                  />
                  {errors.postcode && (
                    <p className="mt-1 text-xs text-red-600">{errors.postcode}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">Used to derive site wind data.</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Expected duration on site</label>
                  <select
                    className="w-full rounded-xl border border-gray-300 p-2.5 focus:outline-none focus:ring"
                    value={form.duration}
                    onChange={(e) => update("duration", e.target.value)}
                  >
                    <option>&lt; 28 days</option>
                    <option>1–3 months</option>
                    <option>3–6 months</option>
                    <option>&gt; 6 months</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Site conditions */}
            <section className="lg:col-span-3 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-medium">Site conditions</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Ground conditions</label>
                  <select
                    className="w-full rounded-xl border border-gray-300 p-2.5 focus:outline-none focus:ring"
                    value={form.ground}
                    onChange={(e) => update("ground", e.target.value)}
                  >
                    <option>Hardstanding (concrete/asphalt)</option>
                    <option>Firm granular (Type 1/compacted)</option>
                    <option>Soft/grass/soil</option>
                    <option>Unknown – assume worst case</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Distance to sea</label>
                  <input
                    className="w-full rounded-xl border p-2.5 focus:outline-none focus:ring"
                    placeholder="km"
                    value={form.distanceToSea}
                    onChange={(e) => update("distanceToSea", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Altitude</label>
                  <input
                    className="w-full rounded-xl border p-2.5 focus:outline-none focus:ring"
                    placeholder="m AOD"
                    value={form.altitude}
                    onChange={(e) => update("altitude", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Fence height</label>
                  <select
                    className="w-full rounded-xl border border-gray-300 p-2.5 focus:outline-none focus:ring"
                    value={form.height}
                    onChange={(e) => update("height", e.target.value)}
                  >
                    <option>2.0 m</option>
                    <option>2.4 m</option>
                    <option>3.0 m</option>
                  </select>
                </div>
              </div>
            </section>

            </form>

          {/* Results */}
          {wind && (
            <section className="mt-8 space-y-6">
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-2 text-lg font-medium">Wind results (example)</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="text-xs text-gray-500">Calculated wind speed</div>
                    <div className="text-2xl font-semibold">{wind.speed_ms.toFixed(0)} m/s</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="text-xs text-gray-500">Calculated wind pressure</div>
                    <div className="text-2xl font-semibold">{wind.pressure_kpa.toFixed(3)} kPa</div>
                  </div>
                </div>
              </div>

              {/* OSM Leaflet map after wind results */}
                            <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-lg font-medium">Fencing options</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {options.map((o) => {
                    const disabled = optionDisabled(o);
                    const isSel = selected.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggleSelect(o.id, disabled)}
                        className={`group relative overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition ${
                          disabled
                            ? "cursor-not-allowed opacity-50 grayscale"
                            : isSel
                            ? "ring-2 ring-[var(--mwp-navy)]"
                            : "hover:shadow"
                        }`}
                      >
                        <img src={o.img} alt={o.name} className="mb-3 h-36 w-full rounded-xl object-cover" />
                        <div className="text-sm font-medium">{o.name}</div>
                        <div className="mt-1 text-xs text-gray-600">
                          Capacity: {o.capacity_kpa.toFixed(3)} kPa · Max height: {o.maxHeight_m.toFixed(1)} m
                        </div>
                        {disabled && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-xs font-medium text-gray-700">
                            Not applicable
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Download zone */}
                <div className="mt-5 flex flex-col items-start gap-3">
                  <div className="text-sm">
                    Download {selected.length} selected Heras fence option{selected.length === 1 ? "" : "s"}
                  </div>
                  <button
                    disabled={selected.length === 0}
                    className={`rounded-2xl px-4 py-2 text-sm shadow-sm ${
                      selected.length === 0 ? "cursor-not-allowed bg-gray-300 text-gray-600" : ""
                    }`}
                    style={selected.length === 0 ? {} : { background: "#003A5D", color: "#fff" }}
                  >
                    Download selected
                  </button>
                  <p className="text-xs text-gray-500">
                    Mock only – would download drawings and calcs with title blocks populated.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
