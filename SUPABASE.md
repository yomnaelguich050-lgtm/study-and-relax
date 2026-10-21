# Serene Mind — connexion Supabase et déploiement Vercel

Site statique HTML / CSS / JavaScript (aucune compilation). Le panier reste local ; catalogue, comptes, commandes et administration passent par Supabase. **Tous les paiements sont simulés** : aucune donnée bancaire n'est demandée ni stockée.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Site existant (design et contenus conservés), panier + checkout Supabase |
| `signup.html`, `login.html`, `verification.html`, `compte.html` | Inscription, connexion, attente de confirmation e-mail, espace client (100 dernières commandes) |
| `admin.html` + `admin.js` | Gestion des commandes et des produits |
| `supabase-client.js` | **Seule** initialisation du client (URL + Publishable key) |
| `supabase-shop.js` | Accès Supabase : auth, catalogue, commandes, admin |
| `script.js` | Panier local et checkout de `index.html` |
| `site-ui.js`, `auth-pages.js`, `tailwind-config.js`, `site.css` | Utilitaires et styles des pages compte/admin |
| `supabase-setup.sql`, `supabase-orders.sql`, `supabase-admin.sql` | Scripts SQL |

> Le fichier d'origine `study_relax_vintage_edition.html` a été conservé tel quel ; la version modifiée est `index.html` (nom attendu par Vercel).

Montants : entiers en centimes, affichés avec deux décimales (ex. `12.00 TND`). Livraison : **7,00 TND, offerte dès 100,00 TND** (constantes dans `supabase-orders.sql` et `script.js` : à garder identiques ; la base fait foi).

---

## 1. Créer le projet Supabase

1. Allez sur <https://supabase.com/dashboard> et connectez-vous.
2. **New project** : choisissez une organisation, un nom (ex. `serene-mind`), un mot de passe de base de données (conservez-le, il ne sert **jamais** dans le site) et une région proche.
3. Attendez la fin de l'initialisation. Le projet doit être **vide** (c'est ce que supposent les scripts). Si vous avez déjà des tables `products`, `user_roles` ou `orders`, **n'exécutez pas** les scripts : une migration distincte est nécessaire.

## 2. Récupérer l'URL et la Publishable key

1. **Project Settings → API Keys** (ou *Connect*).
2. Copiez **Project URL** (`https://xxxx.supabase.co`) et la clé **Publishable** (`sb_publishable_...`).
   Si votre projet affiche encore l'ancienne clé *anon* (`eyJ...`), elle fonctionne aussi à cet emplacement.
3. Ouvrez `supabase-client.js` et remplacez :
   ```js
   var SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
   var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VOTRE_CLE';
   ```
4. **Ne mettez jamais** de clé *secret* / *service_role* dans le site. Les deux valeurs ci-dessus sont publiques par conception ; la sécurité repose sur RLS.

## 3. Exécuter les scripts SQL

Dans **SQL Editor → New query**, collez et exécutez **dans cet ordre** :

1. `supabase-setup.sql` — tables `products` et `user_roles`, fonction `is_admin()`, RLS, catalogue initial (4 produits du site).
2. `supabase-orders.sql` — table `orders`, RLS, fonction `create_demo_order`.
3. `supabase-admin.sql` — **plus tard**, après avoir créé votre compte (voir §6).

Les deux premiers sont relançables sans perte de données. Vérifiez dans **Table Editor** que `products` contient 4 lignes et que RLS est activé (badge) sur `products`, `user_roles` et `orders`.

## 4. Configurer l'authentification

**Authentication → URL Configuration** :

- **Site URL** : `http://localhost:8000` pendant le développement (puis l'adresse Vercel en production).
- **Redirect URLs** : ajoutez
  - `http://localhost:8000/**`
  - `https://VOTRE-SITE.vercel.app/**`

**Authentication → Providers → Email** : laissez *Confirm email* activé (recommandé). Si vous le désactivez, l'inscription ouvre directement la session.

> Le service d'e-mail par défaut de Supabase est limité (quelques e-mails par heure) et peut atterrir en spam. Pour un usage réel, configurez un SMTP personnalisé (*Authentication → Emails → SMTP*).

La récupération de mot de passe **n'est pas implémentée** dans ce site : aucun lien « mot de passe oublié » n'est proposé.

## 5. Lancer le site en local

Ne l'ouvrez pas en `file://` (les redirections d'e-mail ne fonctionneraient pas). Depuis le dossier du site :

```bash
python3 -m http.server 8000
```

puis ouvrez <http://localhost:8000>.

## 6. Créer le compte administrateur

1. Ouvrez `signup.html`, créez votre compte, cliquez sur le lien reçu par e-mail, puis connectez-vous.
2. Supabase : **Authentication → Users**, copiez l'**UUID** de votre utilisateur.
3. Ouvrez `supabase-admin.sql`, remplacez `VOTRE-UUID` (gardez les apostrophes), puis exécutez-le dans SQL Editor. La requête finale doit renvoyer 1 ligne.
4. Reconnectez-vous : le lien **Admin** apparaît. Seul SQL Editor peut attribuer ce rôle ; aucune action du navigateur ne le peut.

## 7. Tester

Faites ces tests avec de **vraies sessions** (fenêtres de navigation privée distinctes), pas avec SQL Editor (le rôle propriétaire contourne RLS).

| Acteur | À vérifier |
|---|---|
| Visiteur | Voit les produits disponibles ; « Proceed to checkout » renvoie vers la connexion ; `admin.html` demande de se connecter |
| Client A | Passe une commande (total = sous-total + livraison) ; la voit dans `compte.html` ; `admin.html` affiche « réservé à l'administrateur » |
| Client B | Ne voit **pas** les commandes de A |
| Admin | Voit toutes les commandes, change un statut, crée/modifie/supprime un produit |
| Erreurs | Coupez le réseau pendant « Place demo order » : le panier est conservé ; relancez : pas de doublon (même identifiant de tentative) |
| Prix | Modifiez un prix dans l'admin pendant qu'un panier est ouvert : la commande est refusée avec « prices changed » |
| Concurrence | Ouvrez la même commande dans deux onglets admin, changez le statut dans le premier puis le second : le second est refusé et rechargé |

Un produit masqué (« Visible in the shop » décoché) disparaît pour les visiteurs. Un contrôle côté navigateur ne remplace pas ces tests : cacher le bouton Admin n'est pas de la sécurité, c'est RLS qui protège.

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| « Supabase is not configured yet » | `supabase-client.js` contient encore les valeurs `VOTRE-…` |
| Catalogue vide / « permission » | `supabase-setup.sql` non exécuté, ou produits tous masqués |
| E-mail de confirmation absent | Délai, spam, limite d'envoi Supabase ; utilisez « Send the e-mail again » (1/min) ou un SMTP |
| Le lien de confirmation ouvre une mauvaise adresse | Site URL / Redirect URLs (§4) ne correspondent pas à l'adresse utilisée |
| « Incorrect e-mail or password » | Identifiants faux, ou compte créé dans un autre projet Supabase |
| « Please confirm your e-mail » | Cliquez d'abord sur le lien de confirmation |
| Lien Admin absent | `supabase-admin.sql` non exécuté avec le bon UUID ; reconnectez-vous |
| `function ... create_demo_order ... not found` | `supabase-orders.sql` non exécuté (ou exécuté sur un autre projet) |
| « Prices changed… » | Le catalogue a changé : le panier est recalculé, validez à nouveau |
| Erreur « row-level security » sur un produit | Compte non admin |

## 9. Déployer sur Vercel (adresse `vercel.app`)

1. Mettez le dossier du site dans un dépôt **GitHub** (les fichiers `index.html`, `*.js`, `*.css` à la racine du dépôt). Pensez à y mettre aussi les `.sql` et ce fichier (ils sont inoffensifs, aucun secret).
2. Sur <https://vercel.com> : **Add New → Project**, importez le dépôt.
3. Réglages :
   - **Framework Preset** : **Other** (site HTML statique)
   - **Root Directory** : le dossier contenant `index.html` (la racine du dépôt si tout y est)
   - **Build Command** : *vide* (aucune compilation)
   - **Output Directory** : *vide* / `.` (le dossier racine est servi tel quel)
   - **Install Command** : vide
4. **Deploy**. Vous obtenez `https://VOTRE-SITE.vercel.app`.
5. Retournez dans Supabase (**Authentication → URL Configuration**) : remplacez la **Site URL** par l'adresse Vercel et vérifiez que `https://VOTRE-SITE.vercel.app/**` figure dans **Redirect URLs**.
6. Testez sur l'URL HTTPS finale : inscription + e-mail de confirmation, connexion, commande, compte, admin.

Si le projet passe un jour à un framework (Vite, Next…), adaptez *Framework Preset*, *Build Command* et *Output Directory* à sa compilation, et chargez la clé via les variables d'environnement du framework (jamais `process.env` dans un script brut du navigateur).

---

## Limites connues

- Récupération de mot de passe non implémentée.
- Le texte « 1er mois gratuit / 3 TND par mois » reste un message commercial : **aucune facturation d'abonnement n'est implémentée** (le faux essai local a été retiré).
- Aucun téléversement d'images : fichier existant du site ou URL HTTPS publique.
- Comptes et commandes locaux d'avant l'intégration ne sont pas importés.
- Les scripts SQL n'ont été vérifiés que par analyse syntaxique ; leur exécution et les tests de droits doivent être faits sur votre projet Supabase (§3 et §7).
