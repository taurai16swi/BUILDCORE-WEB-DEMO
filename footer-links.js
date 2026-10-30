
const footerLinksRoot = document.querySelector("#footer-links");

function isSafeHref(value) {
  if (typeof value !== "string") return false;

  const href = value.trim();

  if (!href || /[\u0000-\u001f]/.test(href)) {
    return false;
  }

  // Allow absolute web links, email links and telephone links.
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
    try {
      const url = new URL(href);

      return ["http:", "https:", "mailto:", "tel:"].includes(
        url.protocol
      );
    } catch {
      return false;
    }
  }

  // Allow safe relative paths and page anchors.
  if (href.startsWith("//") || href.includes("\\")) {
    return false;
  }

  if (/^(\/(?!\/)|\?[^\\]*|#[^\\]*)/.test(href)) {
    return true;
  }

  return false;
}

function renderFooterLinks(links) {
  if (!footerLinksRoot) return;

  footerLinksRoot.replaceChildren();

  links.forEach((item) => {
    const label =
      typeof item.label === "string" ? item.label.trim() : "";

    const href =
      typeof item.href === "string" ? item.href.trim() : "";

    if (!label) return;

    const link = isSafeHref(href)
      ? document.createElement("a")
      : document.createElement("span");

    link.textContent = label;

    if (link instanceof HTMLAnchorElement) {
      link.href = href;

      if (/^https?:\/\//i.test(href)) {
        link.rel = "noopener noreferrer";
      }
    }

    footerLinksRoot.append(link);
  });
}

async function loadFooterLinks() {
  if (!footerLinksRoot) return;

  try {
    // Reuse the client initialized by supabase-backend.js.
    const backend = await window.BuildCoreSupabaseReady;
    const supabase = backend?.client;

    if (!supabase) {
      console.info(
        "Footer links will use the existing static footer."
      );
      return;
    }

    const { data, error } = await supabase
      .from("footer_links")
      .select("label, href")
      .eq("enabled", true)
      .order("position", { ascending: true });

    if (error) throw error;

    renderFooterLinks(data || []);
  } catch (error) {
    console.error("Could not load BuildCore footer links:", error);
    // Leave the existing footer intact if the request fails.
  }
}

void loadFooterLinks();
