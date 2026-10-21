/* supabase-client.js — UNE seule initialisation du client Supabase.
 *
 * Remplacez les deux valeurs ci-dessous (Project Settings > API Keys) :
 *  - Project URL
 *  - Publishable key (sb_publishable_...) — jamais la clé secret / service_role.
 * Ces deux valeurs sont publiques par conception ; la sécurité repose sur RLS.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://lbybbqdggnbunwbeggcy.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__DS19KrWQtuTCDf6P3uLBg_VzOVM8GE';

  var isPlaceholder =
    SUPABASE_URL.indexOf('VOTRE-PROJET') !== -1 ||
    SUPABASE_PUBLISHABLE_KEY.indexOf('VOTRE_CLE') !== -1;
  var libLoaded = !!(window.supabase && typeof window.supabase.createClient === 'function');

  window.SERENE_SUPABASE_CONFIGURED = !isPlaceholder && libLoaded;
  window.sbClient = window.SERENE_SUPABASE_CONFIGURED
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

  if (isPlaceholder) {
    console.warn('[Serene Mind] Supabase non configuré : renseignez supabase-client.js (voir SUPABASE.md).');
  } else if (!libLoaded) {
    console.error('[Serene Mind] La bibliothèque supabase-js n\'a pas pu être chargée.');
  }
})();
