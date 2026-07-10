/**
 * Génère un article SEO de ~2500 mots sur les chargeurs rapides iPhone
 * et le publie automatiquement sur WordPress.
 *
 * Le sujet du jour est choisi automatiquement selon la date (aucun état
 * à sauvegarder), et les liens Amazon insérés proviennent UNIQUEMENT de
 * products.json (jamais générés par l'IA).
 *
 * Variables d'environnement requises (à mettre dans les secrets GitHub) :
 *   ANTHROPIC_API_KEY   - ta clé API Anthropic
 *   WP_URL              - ex: https://tonblog.fr
 *   WP_USER             - ton identifiant WordPress
 *   WP_APP_PASSWORD     - mot de passe d'application WordPress (pas ton mdp normal)
 *   AMAZON_TAG          - ton tag d'affiliation Amazon (ex: tonpseudo-21)
 *   PUBLISH_STATUS      - "publish" ou "draft" (draft = relecture avant publication, recommandé)
 */

const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const AMAZON_TAG = process.env.AMAZON_TAG || "";
const PUBLISH_STATUS = process.env.PUBLISH_STATUS || "draft";

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
}

function pickTodayTopic(topicsData) {
  const start = new Date(topicsData.start_date + "T00:00:00Z");
  const now = new Date();
  const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const index = ((daysSince % topicsData.topics.length) + topicsData.topics.length) % topicsData.topics.length;
  return topicsData.topics[index];
}

function buildAmazonUrl(product) {
  const base = product.amazon_url;
  if (!AMAZON_TAG) return base;
  const sep = base.includes("?") ? "&" : "?";
  return base.includes("tag=") ? base : `${base}${sep}tag=${AMAZON_TAG}`;
}

function buildPrompt(topic, products) {
  const productList = products
    .map(p => `- id: "${p.id}" | nom: ${p.name} | catégorie: ${p.categorie} | puissance: ${p.puissance} | prix indicatif: ${p.prix_indicatif}`)
    .join("\n");

  return `Tu es un rédacteur SEO francophone spécialisé dans la tech, expert des chargeurs rapides iPhone.

Rédige un article de blog en FRANÇAIS d'environ 2500 mots sur le sujet suivant :
- Type d'article : ${topic.type}
- Angle : ${topic.titre_angle}
- Mot-clé principal à cibler : "${topic.mot_cle_principal}"

CONTRAINTES SEO :
- Un seul titre H1 (le titre de l'article), contenant le mot-clé principal
- Structure en H2/H3 clairs, avec le mot-clé principal et ses variantes réparties naturellement
- Une introduction qui capte l'attention en 2-3 phrases
- Si le type est "comparatif" : inclus un tableau comparatif HTML (<table>) des produits pertinents
- Une section FAQ de 4 à 6 questions/réponses à la fin (bon pour le SEO et les featured snippets)
- Une conclusion avec recommandation claire
- Ton naturel, humain, pas de langue de bois, pas de répétitions artificielles de mots-clés

CONTRAINTE SUR LES PRODUITS (TRÈS IMPORTANT) :
Tu ne dois recommander QUE les produits de cette liste, en insérant EXACTEMENT le token {{LINK:id}} juste après le nom du produit la première fois que tu le mentionnes comme recommandation (pas à chaque occurrence) :
${productList}

Ne mentionne aucun autre produit ni aucune autre marque que ceux listés ci-dessus. N'invente jamais de lien ou d'URL toi-même.

FORMAT DE RÉPONSE :
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans balises markdown, avec exactement cette structure :
{
  "title": "titre de l'article (60 caractères max idéalement)",
  "meta_description": "meta description SEO de 150-160 caractères max",
  "slug": "slug-url-en-minuscules-avec-tirets",
  "excerpt": "résumé de 2 phrases pour l'extrait WordPress",
  "content_html": "le corps complet de l'article en HTML (h2, h3, p, ul, li, table, strong etc.), SANS le titre H1 (il est déjà dans 'title')"
}`;
}

async function generateArticle(topic, products) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: buildPrompt(topic, products) }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erreur API Anthropic (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content.map(b => (b.type === "text" ? b.text : "")).join("\n").trim();

  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let article;
  try {
    article = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Impossible de parser la réponse JSON du modèle:\n" + rawText);
  }
  return article;
}

function insertAffiliateLinks(html, products) {
  let result = html;
  for (const product of products) {
    const token = `{{LINK:${product.id}}}`;
    if (result.includes(token)) {
      const url = buildAmazonUrl(product);
      const anchor = ` <a href="${url}" target="_blank" rel="sponsored noopener nofollow">voir le prix sur Amazon</a>`;
      result = result.split(token).join(anchor);
    }
  }
  return result;
}

function addDisclosure(html) {
  const disclosure =
    '<p><em>En tant que partenaire Amazon, cet article contient des liens affiliés. ' +
    "Nous touchons une commission sur les achats éligibles, sans coût supplémentaire pour vous.</em></p>";
  return disclosure + "\n" + html;
}

async function publishToWordPress(article) {
  const endpoint = `${WP_URL.replace(/\/$/, "")}/wp-json/wp/v2/posts`;
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      // Certains hébergeurs gratuits bloquent les requêtes qui n'ont pas
      // l'air de venir d'un vrai navigateur : on ajoute un User-Agent classique.
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json"
    },
    redirect: "follow",
    body: JSON.stringify({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content: article.content_html,
      status: PUBLISH_STATUS, // "draft" ou "publish"
      meta: {
        // Si tu utilises Yoast SEO ou RankMath, adapte ces clés meta
        // Exemple Yoast: "_yoast_wpseo_metadesc"
        // Exemple RankMath: "rank_math_description"
      }
    })
  });

  // On lit d'abord le texte brut, pour pouvoir diagnostiquer même si ce n'est pas du JSON
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Erreur publication WordPress (HTTP ${response.status}, URL finale: ${response.url}):\n` +
      rawText.slice(0, 500)
    );
  }

  try {
    return JSON.parse(rawText);
  } catch (e) {
    throw new Error(
      `Réponse WordPress inattendue (HTTP ${response.status}, URL finale: ${response.url}) — ce n'est pas du JSON, ` +
      `probablement une page bloquée par l'hébergeur. Début de la réponse:\n` +
      rawText.slice(0, 500)
    );
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY || !WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    throw new Error("Variables d'environnement manquantes. Vérifie tes secrets GitHub.");
  }

  const topicsData = loadJSON("topics.json");
  const productsData = loadJSON("products.json");
  const topic = pickTodayTopic(topicsData);

  console.log(`Sujet du jour (${topic.type}) : ${topic.titre_angle}`);

  const article = await generateArticle(topic, productsData.products);
  article.content_html = insertAffiliateLinks(article.content_html, productsData.products);
  article.content_html = addDisclosure(article.content_html);

  const wordCount = article.content_html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(`Article généré : "${article.title}" (${wordCount} mots environ)`);

  const result = await publishToWordPress(article);
  console.log(`Publié avec succès. Statut: ${result.status} | URL: ${result.link || "(brouillon, pas encore d'URL publique)"}`);
}

main().catch(err => {
  console.error("ÉCHEC:", err.message);
  process.exit(1);
});
