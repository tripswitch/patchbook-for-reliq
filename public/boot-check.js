/* If Patchbook fails before it can draw anything, say so instead of leaving a blank page.
   A separate file (not inline) so the Content-Security-Policy can allow scripts from this site only. */
(function () {
  var errs = [];
  addEventListener("error", function (e) { errs.push(e.message || String(e)); });
  addEventListener("unhandledrejection", function (e) { errs.push("Unhandled: " + String(e.reason)); });
  setTimeout(function () {
    var r = document.getElementById("root");
    if (!r || r.firstChild) return;
    var box = document.createElement("div");
    box.style.cssText = "font:15px system-ui,sans-serif;padding:24px;max-width:40em";
    var h = document.createElement("h2");
    h.style.marginTop = "0";
    h.textContent = "Patchbook didn't start";
    var p = document.createElement("p");
    p.textContent = "Your patches are safe. Close the app completely and open it again. If it still won't start, copy this message into a new issue at github.com/tripswitch/patchbook-for-reliq/issues:";
    var pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;font-size:12px;background:#0001;padding:10px;border-radius:6px";
    pre.textContent = (errs.join("\n") || "No error message") + "\n" + navigator.userAgent;
    var b = document.createElement("button");
    b.textContent = "Reload";
    b.style.cssText = "font:inherit;padding:8px 14px";
    b.onclick = function () { location.reload(); };
    box.append(h, p, pre, b);
    r.append(box);
  }, 6000);
})();
