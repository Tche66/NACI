// Horaires officiels de chaque tirage + jour de la semaine
// Ordre chronologique dans la journée

const TIRAGES_COMPLET = {
  // ══ LUNDI ══
  1: [
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Reveil",             heure: "09:55", type: "standard" },
    { nom: "Etoile",             heure: "12:55", type: "standard" },
    { nom: "Akwaba",             heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Monday Special",     heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ MARDI ══
  2: [
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "La Matinale",        heure: "09:55", type: "standard" },
    { nom: "Emergence",          heure: "12:55", type: "standard" },
    { nom: "Sika",               heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Lucky Tuesday",      heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ MERCREDI ══
  3: [
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Premiere Heure",     heure: "09:55", type: "standard" },
    { nom: "Fortune",            heure: "12:55", type: "standard" },
    { nom: "Baraka",             heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Midweek",            heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ JEUDI ══
  4: [
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Kado",               heure: "09:55", type: "standard" },
    { nom: "Privilege",          heure: "12:55", type: "standard" },
    { nom: "Monni",              heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Fortune Thursday",   heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ VENDREDI ══
  5: [
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Cash",               heure: "09:55", type: "standard" },
    { nom: "Solution",           heure: "12:55", type: "standard" },
    { nom: "Wari",               heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Friday Bonanza",     heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ SAMEDI ══
  6: [
    { nom: "Special Weekend 1h", heure: "01:00", type: "digital" },
    { nom: "Special Weekend 3h", heure: "03:00", type: "digital" },
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Soutra",             heure: "09:55", type: "standard" },
    { nom: "Diamant",            heure: "12:55", type: "standard" },
    { nom: "Moaye",              heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "National",           heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
  // ══ DIMANCHE ══
  0: [
    { nom: "Special Weekend 1h", heure: "01:00", type: "digital" },
    { nom: "Special Weekend 3h", heure: "03:00", type: "digital" },
    { nom: "Digital Reveil 7h",  heure: "06:58", type: "digital" },
    { nom: "Digital Reveil 8h",  heure: "07:58", type: "digital" },
    { nom: "Benediction",        heure: "09:55", type: "standard" },
    { nom: "Prestige",           heure: "12:55", type: "standard" },
    { nom: "Awale",              heure: "15:55", type: "standard" },
    { nom: "Afterwork",          heure: "17:55", type: "standard" },
    { nom: "Espoir",             heure: "18:30", type: "special" },
    { nom: "Digital 21h",        heure: "20:58", type: "digital" },
    { nom: "Digital 22h",        heure: "21:58", type: "digital" },
    { nom: "Digital 23h",        heure: "22:58", type: "digital" },
  ],
};

const JOURS_NOMS = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

function getTiragesJour(dayOfWeek) {
  return TIRAGES_COMPLET[dayOfWeek] || [];
}

function getNomsTiragesJour(dayOfWeek) {
  return getTiragesJour(dayOfWeek).map(t => t.nom);
}

module.exports = { TIRAGES_COMPLET, JOURS_NOMS, getTiragesJour, getNomsTiragesJour };
