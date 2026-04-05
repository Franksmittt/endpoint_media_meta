/**
 * Client dashboard — schema v2: billing + performance + cent checks.
 */
(function () {
  "use strict";

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

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

  var clientId = qs("client");
  if (!clientId || !/^[a-z0-9_-]+$/i.test(clientId)) {
    setText("dash-title", "Missing client");
    document.getElementById("main-dash").innerHTML =
      '<p class="empty">Use the home page or add <code>?client=vaalpenskraal</code> or <code>?client=miwesu</code>.</p>';
    return;
  }

  document.querySelectorAll(".tab-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      tab(b.getAttribute("data-tab"));
    });
  });
  tab("billing");

  var dataUrl =
    "/api/client-data?client=" + encodeURIComponent(clientId);

  fetch(dataUrl, { cache: "no-store", credentials: "same-origin" })
    .then(function (r) {
      if (r.status === 401) {
        window.location.replace("login.html");
        return Promise.reject(new Error("auth"));
      }
      if (r.status === 403) {
        throw new Error("You do not have access to this client.");
      }
      if (!r.ok) throw new Error("Could not load client data (" + r.status + ").");
      return r.json();
    })
    .then(function (data) {
      setText("dash-title", data.displayName || clientId);
      setText("gen-at", "Last built (UTC): " + (data.generatedAt || "—"));

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

      var meth = document.getElementById("method-body");
      if (meth) meth.textContent = bill.methodology || "";

      var inv = bill.invoices || [];
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
            (row.paymentDate || "—") +
            "</td>" +
            '<td class="mono">' +
            (row.transactionId || "—") +
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
            (row.sha256 ? row.sha256.slice(0, 10) + "…" : "—") +
            "</td>";
          tbody.appendChild(tr);
        });
      }

      /* Performance tab */
      var perf = data.performance || {};
      var pt = perf.totals || {};
      setText("perf-range", (perf.reporting && perf.reporting.starts) || "—");
      setText("perf-range-end", (perf.reporting && perf.reporting.ends) || "—");
      setText("perf-spend", "ZAR " + (pt.spendZar || "0.00"));
      setText("perf-imp", String(pt.impressions || 0));
      setText("perf-reach", String(pt.reach || 0));
      setText("perf-results", String(pt.results || 0));
      setText("perf-source", perf.sourceCsv || "—");

      var ptbody = document.querySelector("#perf-table tbody");
      if (ptbody) {
        ptbody.innerHTML = "";
        (perf.campaigns || []).forEach(function (c) {
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" +
            escapeHtml((c.campaignName || "").slice(0, 80)) +
            (c.campaignName && c.campaignName.length > 80 ? "…" : "") +
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
            escapeHtml(c.resultType || "—") +
            "</td>" +
            '<td class="num">' +
            c.results +
            "</td>" +
            "<td>" +
            escapeHtml(c.deliveryStatus || "—") +
            "</td>";
          ptbody.appendChild(tr);
        });
      }

      perfCampaignsCache = perf.campaigns || [];
    })
    .catch(function (err) {
      if (String(err.message) === "auth") return;
      setText("dash-title", "Error");
      document.getElementById("main-dash").innerHTML =
        '<p class="empty">' + escapeHtml(String(err.message || err)) + "</p>";
    });

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

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
      return n.length < (c.campaignName || "").length ? n + "…" : n;
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
