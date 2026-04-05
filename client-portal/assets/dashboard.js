/**
 * Client dashboard: schema v2 (billing + performance + cent checks).
 */
(function () {
  "use strict";

  function zarCents(s) {
    var n = parseFloat(String(s).replace(",", ""), 10);
    if (Number.isNaN(n)) return null;
    return Math.round(n * 100);
  }

  function fmtZarFromCents(c) {
    var neg = c < 0;
    c = Math.abs(c);
    return (neg ? "-" : "") + (c / 100).toFixed(2);
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function encPath(p) {
    return p
      .split("/")
      .filter(function (x) {
        return x.length;
      })
      .map(encodeURIComponent)
      .join("/");
  }

  function getBilling(data) {
    if (data.billing) return data.billing;
    return {
      totals: data.totals,
      invoices: data.invoices || [],
      methodology: data.methodology || "",
    };
  }

  function showVerify(ok, msg, warn) {
    var el = document.getElementById("verify");
    if (!el) return;
    el.className = "verify " + (warn ? "warn" : ok ? "ok" : "bad");
    el.textContent = msg;
    el.hidden = false;
  }

  var perfCampaignsCache = null;
  var spendChartInstance = null;

  function tab(name) {
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.hidden = p.getAttribute("data-tab") !== name;
    });
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === name);
    });
    if (name === "performance" && perfCampaignsCache) {
      window.requestAnimationFrame(function () {
        renderSpendChart(perfCampaignsCache);
      });
    }
  }

  var clientId = "miwesu";

  document.querySelectorAll(".tab-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      tab(b.getAttribute("data-tab"));
    });
  });
  tab("billing");

  var dataUrl = "data/clients/" + encodeURIComponent(clientId) + ".json";

  fetch(dataUrl, { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load report data (" + r.status + "). Rebuild with build_report.py if needed.");
      return r.json();
    })
    .then(function (data) {
      setText("dash-title", data.displayName || clientId);
      setText("gen-at", "Last built (UTC): " + (data.generatedAt || "n/a"));

      var bill = getBilling(data);
      var ts = bill.totals || {};
      var useCents =
        ts.subtotalCents != null &&
        ts.totalCents != null &&
        bill.invoices &&
        bill.invoices.length &&
        bill.invoices[0].totalCents != null;

      setText("t-sub", "ZAR " + (ts.subtotal || "0.00"));
      setText("t-vat", "ZAR " + (ts.vat || "0.00"));
      setText("t-tot", "ZAR " + (ts.total || "0.00"));
      setText("snap-total", "ZAR " + (ts.total || "0.00"));
      setText("story-meta-total", "ZAR " + (ts.total || "0.00"));

      var meth = document.getElementById("method-body");
      if (meth) meth.textContent = bill.methodology || "";

      var inv = bill.invoices || [];
      setText("snap-receipts", String(inv.length));
      var sumSub = 0,
        sumVat = 0,
        sumTot = 0;
      for (var i = 0; i < inv.length; i++) {
        var row = inv[i];
        if (useCents) {
          sumSub += row.subtotalCents || 0;
          sumVat += row.vatCents || 0;
          sumTot += row.totalCents || 0;
        } else {
          var cs = zarCents(row.subtotal);
          var cv = zarCents(row.vat);
          var ct = zarCents(row.total);
          if (cs !== null) sumSub += cs;
          if (cv !== null) sumVat += cv;
          if (ct !== null) sumTot += ct;
        }
      }

      var expSub = useCents ? ts.subtotalCents : zarCents(ts.subtotal);
      var expVat = useCents ? ts.vatCents : zarCents(ts.vat);
      var expTot = useCents ? ts.totalCents : zarCents(ts.total);

      var match =
        expSub !== null &&
        expVat !== null &&
        expTot !== null &&
        sumSub === expSub &&
        sumVat === expVat &&
        sumTot === expTot;

      if (data.integrity && data.integrity.billingLinesMatchTotals === false) {
        showVerify(false, "Build reported a billing integrity issue. Re-run the build script.");
      } else if (match) {
        showVerify(
          true,
          "Check passed: sum of " +
            inv.length +
            " billing rows equals totals (verified in cents)."
        );
      } else {
        showVerify(
          false,
          "Mismatch: row sums ZAR " +
            fmtZarFromCents(sumSub) +
            " / " +
            fmtZarFromCents(sumVat) +
            " / " +
            fmtZarFromCents(sumTot) +
            " vs totals."
        );
      }

      var tbody = document.querySelector("#inv-table tbody");
      if (tbody) {
        tbody.innerHTML = "";
        inv.forEach(function (row) {
          var tr = document.createElement("tr");
          var pdfLink =
            '<a href="' +
            encodeURI(row.pdfPath) +
            '" download target="_blank" rel="noopener">Download</a>';
          tr.innerHTML =
            "<td>" +
            (row.paymentDate || "n/a") +
            "</td>" +
            '<td class="mono">' +
            (row.transactionId || "n/a") +
            "</td>" +
            "<td>" +
            pdfLink +
            "</td>" +
            '<td class="num">' +
            row.subtotal +
            "</td>" +
            '<td class="num">' +
            row.vat +
            "</td>" +
            '<td class="num">' +
            row.total +
            "</td>" +
            '<td class="mono" title="' +
            (row.sha256 || "") +
            '">' +
            (row.sha256 ? row.sha256.slice(0, 10) + "..." : "n/a") +
            "</td>";
          tbody.appendChild(tr);
        });
      }

      /* Performance tab */
      var perf = data.performance || {};
      var pt = perf.totals || {};
      setText("perf-range", (perf.reporting && perf.reporting.starts) || "n/a");
      setText("perf-range-end", (perf.reporting && perf.reporting.ends) || "n/a");
      setText("perf-spend", "ZAR " + (pt.spendZar || "0.00"));
      setText("snap-spend", "ZAR " + (pt.spendZar || "0.00"));
      setText("perf-imp", String(pt.impressions || 0));
      setText("perf-reach", String(pt.reach || 0));
      setText("perf-results", String(pt.results || 0));
      setText("perf-source", perf.sourceCsv || "n/a");

      var ptbody = document.querySelector("#perf-table tbody");
      if (ptbody) {
        ptbody.innerHTML = "";
        (perf.campaigns || []).forEach(function (c) {
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" +
            escapeHtml((c.campaignName || "").slice(0, 80)) +
            (c.campaignName && c.campaignName.length > 80 ? "..." : "") +
            "</td>" +
            "<td>" +
            escapeHtml((c.adSetName || "").slice(0, 60)) +
            "</td>" +
            '<td class="num">' +
            (c.spendCents / 100).toFixed(2) +
            "</td>" +
            '<td class="num">' +
            c.impressions +
            "</td>" +
            "<td>" +
            escapeHtml(c.resultType || "n/a") +
            "</td>" +
            '<td class="num">' +
            c.results +
            "</td>" +
            "<td>" +
            escapeHtml(c.deliveryStatus || "n/a") +
            "</td>";
          ptbody.appendChild(tr);
        });
      }

      perfCampaignsCache = perf.campaigns || [];
    })
    .catch(function (err) {
      setText("dash-title", "Could not load report");
      var e = document.getElementById("dash-load-err");
      if (e) {
        e.textContent = String(err.message || err);
        e.hidden = false;
      }
      var tabs = document.getElementById("dash-tabs");
      if (tabs) tabs.hidden = true;
      document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.hidden = true;
      });
    });

  function renderAprilTab(ap) {
    var intro = document.getElementById("april-intro");
    if (intro) intro.textContent = ap.intro || "";
    var sh = document.getElementById("april-sched-host");
    var eh = document.getElementById("april-extra-host");
    var ext = document.getElementById("april-extra-title");
    if (!sh || !eh) return;
    sh.innerHTML = "";
    (ap.scheduled || []).forEach(function (s) {
      var card = document.createElement("div");
      card.className = "work-card";
      var u = encPath(s.url);
      var media =
        s.kind === "video"
          ? '<video controls preload="metadata" playsinline src="' + escapeHtml(u) + '"></video>'
          : '<img src="' + escapeHtml(u) + '" alt="" loading="lazy">';
      card.innerHTML =
        '<div class="work-card-head"><span class="cal-badge">Scheduled</span><br>' +
        escapeHtml(s.label) +
        '</div><div class="work-card-body">' +
        media +
        '<div class="work-card-actions"><a class="btn" href="' +
        escapeHtml(u) +
        '" download="' +
        escapeHtml(s.file) +
        '">Download</a></div></div>';
      sh.appendChild(card);
    });
    var extra = ap.additional || [];
    if (ext) ext.hidden = extra.length === 0;
    eh.innerHTML = "";
    eh.hidden = extra.length === 0;
    extra.forEach(function (s) {
      var card = document.createElement("div");
      card.className = "work-card";
      var u = encPath(s.url);
      var media =
        s.kind === "video"
          ? '<video controls preload="metadata" playsinline src="' + escapeHtml(u) + '"></video>'
          : '<img src="' + escapeHtml(u) + '" alt="" loading="lazy">';
      card.innerHTML =
        '<div class="work-card-body">' +
        media +
        '<div class="work-card-actions"><a class="btn" href="' +
        escapeHtml(u) +
        '" download="' +
        escapeHtml(s.file) +
        '">Download</a></div></div>';
      eh.appendChild(card);
    });
  }

  fetch("data/april-creative.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) return Promise.reject();
      return r.json();
    })
    .then(function (ap) {
      var n = (ap.scheduled || []).length + (ap.additional || []).length;
      setText("snap-april", String(n));
      renderAprilTab(ap);
    })
    .catch(function () {
      setText("snap-april", "n/a");
      var btn = document.getElementById("tab-april");
      if (btn) btn.hidden = true;
      var panel = document.querySelector('.tab-panel[data-tab="april"]');
      if (panel) panel.remove();
    });

  function renderSpendChart(campaigns) {
    var canvas = document.getElementById("spendChart");
    if (!canvas || typeof Chart === "undefined") return;
    var top = campaigns.slice(0, 10);
    if (!top.length) return;
    if (spendChartInstance) {
      spendChartInstance.destroy();
      spendChartInstance = null;
    }
    var labels = top.map(function (c, i) {
      var n = (c.campaignName || "Campaign").slice(0, 28);
      return n.length < (c.campaignName || "").length ? n + "..." : n;
    });
    var data = top.map(function (c) {
      return c.spendCents / 100;
    });
    spendChartInstance = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Spend (ZAR)",
            data: data,
            backgroundColor: "rgba(34, 211, 238, 0.45)",
            borderColor: "rgba(34, 211, 238, 0.9)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Top campaigns by spend (this export)", color: "#9ca3af" },
        },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#e5e7eb", font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  }
})();
