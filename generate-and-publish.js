/**
 * Génère un article SEO de ~2500 mots sur les chargeurs rapides iPhone
 * et le publie directement sur le site GitHub Pages (aucun hébergeur tiers,
 * donc aucun risque de blocage anti-robot).
 *
 * Le sujet du jour est choisi automatiquement selon la date (aucun état
 * à sauvegarder), et les liens Amazon insérés proviennent UNIQUEMENT de
 * products.json (jamais générés par l'IA).
 *
 * Variables d'environnement requises (secrets GitHub) :
 *   ANTHROPIC_API_KEY   - ta clé API Anthropic
 *   AMAZON_TAG          - ton tag d'affiliation Amazon (ex: tonpseudo-21)
 *   PUBLISH_STATUS      - "publish" ou "draft"
 *                         "draft" = le fichier est créé mais caché du site public
 *                         (front matter published: false), pour relecture avant publication.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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
- Structure en H2/H3 clairs (## et ###), avec le mot-clé principal et ses variantes réparties naturellement
- Une introduction qui capte l'attention en 2-3 phrases
- Si le type est "comparatif" : inclus un tableau comparatif en HTML (<table>) des produits pertinents
- Une section FAQ de 4 à 6 questions/réponses à la fin
- Une conclusion avec recommandation claire
- Ton naturel, humain, pas de langue de bois, pas de répétitions artificielles de mots-clés
- N'inclus PAS de titre H1 (le titre est géré séparément)

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
  "content_markdown": "le corps complet de l'article en Markdown (## ### listes, tableaux HTML si besoin), SANS le titre H1"
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

function insertAffiliateLinks(markdown, products) {
  let result = markdown;
  for (const product of products) {
    const token = `{{LINK:${product.id}}}`;
    if (result.includes(token)) {
      const url = buildAmazonUrl(product);
      const link = ` [voir le prix sur Amazon](${url})`;
      result = result.split(token).join(link);
    }
  }
  return result;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // enlève les accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function writePostFile(article) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const slug = slugify(article.slug || article.title);
  const filename = `${today}-${slug}.md`;
  const filepath = path.join(__dirname, "_posts", filename);

  const published = PUBLISH_STATUS === "draft" ? "false" : "true";

  const disclosure =
    "*En tant que partenaire Amazon, cet article contient des liens affiliés. " +
    "Nous touchons une commission sur les achats éligibles, sans coût supplémentaire pour vous.*\n\n";

  const frontMatter =
`---
layout: post
title: "${article.title.replace(/"/g, '\\"')}"
description: "${(article.meta_description || "").replace(/"/g, '\\"')}"
date: ${today} 08:00:00 +0200
published: ${published}
---

`;

  const fullContent = frontMatter + disclosure + article.content_markdown;

  fs.mkdirSync(path.join(__dirname, "_posts"), { recursive: true });
  fs.writeFileSync(filepath, fullContent, "utf8");

  return filepath;
}

function commitAndPush(filepath) {
  const relPath = path.relative(__dirname, filepath);
  execSync(`git config user.name "blog-auto-bot"`, { cwd: __dirname, stdio: "inherit" });
  execSync(`git config user.email "blog-auto-bot@users.noreply.github.com"`, { cwd: __dirname, stdio: "inherit" });
  execSync(`git add "${relPath}"`, { cwd: __dirname, stdio: "inherit" });
  execSync(`git commit -m "Nouvel article automatique : ${relPath}"`, { cwd: __dirname, stdio: "inherit" });
  execSync(`git push`, { cwd: __dirname, stdio: "inherit" });
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquant. Vérifie tes secrets GitHub.");
  }

  const topicsData = loadJSON("topics.json");
  const productsData = loadJSON("products.json");
  const topic = pickTodayTopic(topicsData);

  console.log(`Sujet du jour (${topic.type}) : ${topic.titre_angle}`);

  const article = await generateArticle(topic, productsData.products);
  article.content_markdown = insertAffiliateLinks(article.content_markdown, productsData.products);

  const wordCount = article.content_markdown.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(`Article généré : "${article.title}" (${wordCount} mots environ)`);

  const filepath = writePostFile(article);
  console.log(`Fichier créé : ${filepath}`);

  commitAndPush(filepath);
  console.log("Publié avec succès sur GitHub Pages (le site se met à jour automatiquement en 1-2 minutes).");
}

main().catch(err => {
  console.error("ÉCHEC:", err.message);
  process.exit(1);
});
