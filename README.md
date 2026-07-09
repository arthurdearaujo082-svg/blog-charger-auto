# Système de publication automatique — Blog chargeurs rapides iPhone

Publie chaque jour un article SEO (~2500 mots) sur ton blog WordPress, avec tes liens
d'affiliation Amazon insérés automatiquement.

## Comment ça marche

1. Chaque jour, GitHub Actions se réveille tout seul et lance `generate-and-publish.js`.
2. Le script choisit le sujet du jour dans `topics.json` (rotation automatique basée sur la date).
3. Il appelle l'API Claude pour rédiger l'article en respectant les contraintes SEO.
4. Il remplace les tokens produits (`{{LINK:id}}`) par tes vrais liens Amazon depuis `products.json`.
5. Il publie l'article sur ton WordPress via l'API REST.

Aucune donnée n'est stockée entre les exécutions : le "sujet du jour" est calculé à partir
de la date, donc pas besoin de base de données.

## Étape 1 — Remplir `products.json`

Ouvre `products.json` et remplace chaque `amazon_url` par ton vrai lien produit
(Amazon Associates → onglet "Créer un lien texte" → copie le lien pour chaque produit).
Tu peux ajouter ou retirer des produits librement — le script s'adapte automatiquement.

⚠️ Le script n'insère JAMAIS de lien qui n'est pas dans ce fichier. C'est volontaire :
ça évite que l'IA invente un ASIN ou une URL qui n'existe pas.

## Étape 2 — Créer un mot de passe d'application WordPress

1. Connecte-toi à ton admin WordPress
2. Va dans **Utilisateurs → Profil**
3. Descends jusqu'à **"Mots de passe d'application"**
4. Crée-en un nommé "blog-auto", copie le mot de passe généré (tu ne le reverras plus)

## Étape 3 — Créer le dépôt GitHub

1. Crée un nouveau dépôt GitHub (privé, recommandé)
2. Mets-y tous les fichiers de ce dossier (`products.json`, `topics.json`,
   `generate-and-publish.js`, `.github/workflows/daily-post.yml`)

## Étape 4 — Ajouter tes secrets

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions → New repository secret**

Ajoute ces 6 secrets :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | Ta clé API sur console.anthropic.com |
| `WP_URL` | `https://tonblog.fr` |
| `WP_USER` | Ton identifiant WordPress |
| `WP_APP_PASSWORD` | Le mot de passe d'application (étape 2) |
| `AMAZON_TAG` | Ton tag Amazon Associates, ex `tonpseudo-21` |
| `PUBLISH_STATUS` | `draft` (recommandé au début) ou `publish` |

## Étape 5 — Tester manuellement

Dans l'onglet **Actions** de ton dépôt GitHub → sélectionne le workflow →
**Run workflow** pour lancer un premier test sans attendre le lendemain.

Vérifie ensuite dans WordPress que le brouillon a bien été créé, relis-le,
puis passe `PUBLISH_STATUS` à `publish` une fois que tu es satisfait de la qualité.

## Recommandation importante

Je te conseille de laisser `PUBLISH_STATUS=draft` pendant au moins 1 à 2 semaines
et de relire chaque article avant de le publier réellement. Pourquoi :

- **Qualité/exactitude** : un modèle peut se tromper sur des caractéristiques techniques
  (puissance réelle, compatibilité) — une relecture rapide évite les erreurs sur ton blog
- **Règles Amazon Associates** : le programme exige un contenu exact, avec une vraie
  divulgation d'affiliation (déjà ajoutée automatiquement en haut de chaque article),
  et interdit le contenu trompeur
- **SEO** : Google déclasse le contenu jugé "généré en masse sans valeur ajoutée" —
  une relecture/légère édition humaine aide à la qualité perçue

Une fois en rythme de croisière, tu peux passer en `publish` direct si tu veux du 100% automatique.

## Personnaliser la fréquence ou les sujets

- Ajoute des sujets dans `topics.json` (types possibles : `comparatif`, `guide`, `article`)
- Change l'heure de publication dans `.github/workflows/daily-post.yml` (ligne `cron:`)
- Ajoute des produits dans `products.json` à tout moment

## Coûts

- GitHub Actions : gratuit pour ce volume (un run par jour)
- API Anthropic : facturé à l'usage selon ta clé (un article de 2500 mots = quelques centimes)
- Aucun autre coût
