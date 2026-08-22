// Static per-trek route data powering the itinerary engine.
// Mirrors the trek ids in data/destinations.ts (frontend) and trek-metadata.ts.
// This is trek route DATA only — not the recommendation engine.

export interface RouteStage {
  day: number;
  from: string;
  to: string;
  distance: number;
  elevationGain: number;
  estimatedHours: number;
  checkpoint: string;
  restStop: string;
}

export interface TrekRoute {
  trekId: string;
  name: string;
  difficulty: string;
  routeStages: RouteStage[];
}

export const TREK_ROUTES: TrekRoute[] = [
  {
    "trekId": "1",
    "name": "Classic ABC",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Ghandruk",
        "distance": 8,
        "elevationGain": 500,
        "estimatedHours": 4,
        "checkpoint": "Nayapul",
        "restStop": "Birethanti"
      },
      {
        "day": 2,
        "from": "Ghandruk",
        "to": "Chomrong",
        "distance": 6,
        "elevationGain": 600,
        "estimatedHours": 5,
        "checkpoint": "Kimrong",
        "restStop": "Jhinu Danda"
      },
      {
        "day": 3,
        "from": "Chomrong",
        "to": "Dovan",
        "distance": 7,
        "elevationGain": 700,
        "estimatedHours": 5,
        "checkpoint": "Sinuwa",
        "restStop": "Bamboo"
      },
      {
        "day": 4,
        "from": "Dovan",
        "to": "Deurali",
        "distance": 6,
        "elevationGain": 650,
        "estimatedHours": 4,
        "checkpoint": "Himalaya Hotel",
        "restStop": "Bagar"
      },
      {
        "day": 5,
        "from": "Deurali",
        "to": "Annapurna Base Camp",
        "distance": 8,
        "elevationGain": 900,
        "estimatedHours": 6,
        "checkpoint": "Machhapuchhre Base Camp",
        "restStop": "MBC"
      },
      {
        "day": 6,
        "from": "ABC",
        "to": "Bamboo",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "MBC",
        "restStop": "Sinuwa"
      },
      {
        "day": 7,
        "from": "Bamboo",
        "to": "Pokhara",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Jhinu Danda",
        "restStop": "Nayapul"
      }
    ]
  },
  {
    "trekId": "2",
    "name": "Poon Hill Panorama ABC",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Tikhedhunga",
        "distance": 7,
        "elevationGain": 400,
        "estimatedHours": 3,
        "checkpoint": "Nayapul",
        "restStop": "Birethanti"
      },
      {
        "day": 2,
        "from": "Tikhedhunga",
        "to": "Ghorepani",
        "distance": 5,
        "elevationGain": 1320,
        "estimatedHours": 6,
        "checkpoint": "Ulleri",
        "restStop": "Ulleri"
      },
      {
        "day": 3,
        "from": "Ghorepani",
        "to": "Tadapani",
        "distance": 8,
        "elevationGain": 350,
        "estimatedHours": 5,
        "checkpoint": "Poon Hill",
        "restStop": "Deurali"
      },
      {
        "day": 4,
        "from": "Tadapani",
        "to": "Chomrong",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 4,
        "checkpoint": "Jhinu",
        "restStop": "Jhinu Danda"
      },
      {
        "day": 5,
        "from": "Chomrong",
        "to": "Himalaya Hotel",
        "distance": 7,
        "elevationGain": 730,
        "estimatedHours": 5,
        "checkpoint": "Sinuwa",
        "restStop": "Bamboo"
      },
      {
        "day": 6,
        "from": "Himalaya Hotel",
        "to": "Machhapuchhre Base Camp",
        "distance": 8,
        "elevationGain": 800,
        "estimatedHours": 5,
        "checkpoint": "Deurali",
        "restStop": "Deurali"
      },
      {
        "day": 7,
        "from": "MBC",
        "to": "Annapurna Base Camp",
        "distance": 4,
        "elevationGain": 430,
        "estimatedHours": 3,
        "checkpoint": "Glacier Moraine",
        "restStop": "ABC"
      },
      {
        "day": 8,
        "from": "ABC",
        "to": "Bamboo",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "MBC",
        "restStop": "Sinuwa"
      },
      {
        "day": 9,
        "from": "Bamboo",
        "to": "Ghandruk",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Chomrong",
        "restStop": "Chomrong"
      },
      {
        "day": 10,
        "from": "Ghandruk",
        "to": "Pokhara",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Nayapul",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "3",
    "name": "Thorong La Circuit",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Besisahar",
        "to": "Bahundanda",
        "distance": 8,
        "elevationGain": 600,
        "estimatedHours": 5,
        "checkpoint": "Bhulbhule",
        "restStop": "Ngadi"
      },
      {
        "day": 2,
        "from": "Bahundanda",
        "to": "Chame",
        "distance": 10,
        "elevationGain": 700,
        "estimatedHours": 6,
        "checkpoint": "Syange",
        "restStop": "Tal"
      },
      {
        "day": 3,
        "from": "Chame",
        "to": "Pisang",
        "distance": 8,
        "elevationGain": 590,
        "estimatedHours": 5,
        "checkpoint": "Bhratang",
        "restStop": "Dukure Pokhari"
      },
      {
        "day": 4,
        "from": "Pisang",
        "to": "Manang",
        "distance": 7,
        "elevationGain": 500,
        "estimatedHours": 5,
        "checkpoint": "Ghyaru",
        "restStop": "Ngawal"
      },
      {
        "day": 5,
        "from": "Manang",
        "to": "Manang",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Manang"
      },
      {
        "day": 6,
        "from": "Manang",
        "to": "Thorong Phedi",
        "distance": 6,
        "elevationGain": 950,
        "estimatedHours": 4,
        "checkpoint": "Yak Kharka",
        "restStop": "Thorong Phedi"
      },
      {
        "day": 7,
        "from": "Thorong Phedi",
        "to": "Muktinath",
        "distance": 10,
        "elevationGain": 966,
        "estimatedHours": 8,
        "checkpoint": "Thorong La Pass",
        "restStop": "Muktinath"
      },
      {
        "day": 8,
        "from": "Muktinath",
        "to": "Kagbeni",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Jharkot",
        "restStop": "Kagbeni"
      },
      {
        "day": 9,
        "from": "Kagbeni",
        "to": "Jomsom",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Khingar",
        "restStop": "Jomsom"
      },
      {
        "day": 10,
        "from": "Jomsom",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Jomsom Airport",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "4",
    "name": "Tilicho Lake Circuit",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Besisahar",
        "to": "Timang",
        "distance": 10,
        "elevationGain": 1200,
        "estimatedHours": 6,
        "checkpoint": "Bhulbhule",
        "restStop": "Chamje"
      },
      {
        "day": 2,
        "from": "Timang",
        "to": "Manang",
        "distance": 8,
        "elevationGain": 750,
        "estimatedHours": 5,
        "checkpoint": "Upper Pisang",
        "restStop": "Ngawal"
      },
      {
        "day": 3,
        "from": "Manang",
        "to": "Manang",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Manang"
      },
      {
        "day": 4,
        "from": "Manang",
        "to": "Khangsar",
        "distance": 6,
        "elevationGain": 234,
        "estimatedHours": 4,
        "checkpoint": "Gangapurna Glacier",
        "restStop": "Khangsar"
      },
      {
        "day": 5,
        "from": "Khangsar",
        "to": "Tilicho Base Camp",
        "distance": 7,
        "elevationGain": 986,
        "estimatedHours": 6,
        "checkpoint": "Scree Ridge",
        "restStop": "Base Camp"
      },
      {
        "day": 6,
        "from": "Tilicho Base Camp",
        "to": "Tilicho Lake",
        "distance": 4,
        "elevationGain": 199,
        "estimatedHours": 4,
        "checkpoint": "Lake Viewpoint",
        "restStop": "Tilicho Lake"
      },
      {
        "day": 7,
        "from": "Base Camp",
        "to": "Manang",
        "distance": 13,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Khangsar",
        "restStop": "Manang"
      },
      {
        "day": 8,
        "from": "Manang",
        "to": "Besisahar",
        "distance": 25,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Dharapani",
        "restStop": "Besisahar"
      }
    ]
  },
  {
    "trekId": "5",
    "name": "Ghorepani Sunrise Express",
    "difficulty": "Easy",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Ulleri",
        "distance": 8,
        "elevationGain": 900,
        "estimatedHours": 5,
        "checkpoint": "Tikhedhunga",
        "restStop": "Tikhedhunga"
      },
      {
        "day": 2,
        "from": "Ulleri",
        "to": "Ghorepani",
        "distance": 5,
        "elevationGain": 780,
        "estimatedHours": 4,
        "checkpoint": "Rhododendron Forest",
        "restStop": "Ghorepani"
      },
      {
        "day": 3,
        "from": "Ghorepani",
        "to": "Pokhara",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Poon Hill",
        "restStop": "Nayapul"
      }
    ]
  },
  {
    "trekId": "6",
    "name": "Mohare Danda Community Trek",
    "difficulty": "Easy",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Galeshwor",
        "distance": 5,
        "elevationGain": 200,
        "estimatedHours": 2,
        "checkpoint": "Kali Gandaki Valley",
        "restStop": "Galeshwor"
      },
      {
        "day": 2,
        "from": "Galeshwor",
        "to": "Mohare Danda",
        "distance": 8,
        "elevationGain": 2480,
        "estimatedHours": 7,
        "checkpoint": "Oak Forest",
        "restStop": "Mohare Danda"
      },
      {
        "day": 3,
        "from": "Mohare Danda",
        "to": "Tikot",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Ridge Viewpoint",
        "restStop": "Tikot"
      },
      {
        "day": 4,
        "from": "Tikot",
        "to": "Pokhara",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Beni",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "7",
    "name": "Gokyo Lakes & EBC",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Lukla",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi Valley",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche Bazaar",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Jorsale"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Dole",
        "distance": 7,
        "elevationGain": 760,
        "estimatedHours": 5,
        "checkpoint": "Khumjung",
        "restStop": "Phortse"
      },
      {
        "day": 5,
        "from": "Dole",
        "to": "Machhermo",
        "distance": 6,
        "elevationGain": 270,
        "estimatedHours": 4,
        "checkpoint": "Juniper Forest",
        "restStop": "Machhermo"
      },
      {
        "day": 6,
        "from": "Machhermo",
        "to": "Gokyo",
        "distance": 5,
        "elevationGain": 280,
        "estimatedHours": 4,
        "checkpoint": "Longponga Lake",
        "restStop": "Gokyo"
      },
      {
        "day": 7,
        "from": "Gokyo",
        "to": "Gokyo Ri",
        "distance": 3,
        "elevationGain": 607,
        "estimatedHours": 4,
        "checkpoint": "Gokyo Ri Summit",
        "restStop": "Gokyo"
      },
      {
        "day": 8,
        "from": "Gokyo",
        "to": "Dragnag",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Cho La Glacier",
        "restStop": "Dragnag"
      },
      {
        "day": 9,
        "from": "Dragnag",
        "to": "Lobuche",
        "distance": 7,
        "elevationGain": 240,
        "estimatedHours": 5,
        "checkpoint": "Cho La Pass",
        "restStop": "Lobuche"
      },
      {
        "day": 10,
        "from": "Lobuche",
        "to": "Everest Base Camp",
        "distance": 8,
        "elevationGain": 424,
        "estimatedHours": 6,
        "checkpoint": "Gorak Shep",
        "restStop": "Gorak Shep"
      },
      {
        "day": 11,
        "from": "Gorak Shep",
        "to": "Pheriche",
        "distance": 9,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Kala Patthar",
        "restStop": "Thukla"
      },
      {
        "day": 12,
        "from": "Pheriche",
        "to": "Namche",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Tengboche",
        "restStop": "Khumjung"
      },
      {
        "day": 13,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Monjo",
        "restStop": "Phakding"
      },
      {
        "day": 14,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Lukla Airport",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "8",
    "name": "Everest Base Camp Classic",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 4,
        "checkpoint": "Lukla",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche Bazaar",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Jorsale"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Tengboche",
        "distance": 6,
        "elevationGain": 427,
        "estimatedHours": 5,
        "checkpoint": "Khumjung",
        "restStop": "Tengboche"
      },
      {
        "day": 5,
        "from": "Tengboche",
        "to": "Dingboche",
        "distance": 7,
        "elevationGain": 543,
        "estimatedHours": 5,
        "checkpoint": "Pangboche",
        "restStop": "Dingboche"
      },
      {
        "day": 6,
        "from": "Dingboche",
        "to": "Dingboche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Dingboche"
      },
      {
        "day": 7,
        "from": "Dingboche",
        "to": "Lobuche",
        "distance": 6,
        "elevationGain": 530,
        "estimatedHours": 5,
        "checkpoint": "Thukla Memorials",
        "restStop": "Lobuche"
      },
      {
        "day": 8,
        "from": "Lobuche",
        "to": "Everest Base Camp",
        "distance": 8,
        "elevationGain": 424,
        "estimatedHours": 7,
        "checkpoint": "Gorak Shep",
        "restStop": "Gorak Shep"
      },
      {
        "day": 9,
        "from": "Gorak Shep",
        "to": "Pheriche",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Kala Patthar",
        "restStop": "Pheriche"
      },
      {
        "day": 10,
        "from": "Pheriche",
        "to": "Namche",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Tengboche",
        "restStop": "Namche"
      },
      {
        "day": 11,
        "from": "Namche",
        "to": "Kathmandu",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Lukla",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "9",
    "name": "Renjo La Three Passes",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Lukla",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Namche"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Thame",
        "distance": 6,
        "elevationGain": 360,
        "estimatedHours": 4,
        "checkpoint": "Bhote Kosi Valley",
        "restStop": "Thame"
      },
      {
        "day": 5,
        "from": "Thame",
        "to": "Lungden",
        "distance": 7,
        "elevationGain": 580,
        "estimatedHours": 5,
        "checkpoint": "Yak Pastures",
        "restStop": "Lungden"
      },
      {
        "day": 6,
        "from": "Lungden",
        "to": "Gokyo",
        "distance": 8,
        "elevationGain": 1008,
        "estimatedHours": 7,
        "checkpoint": "Renjo La Pass",
        "restStop": "Gokyo"
      },
      {
        "day": 7,
        "from": "Gokyo",
        "to": "Gokyo",
        "distance": 3,
        "elevationGain": 607,
        "estimatedHours": 4,
        "checkpoint": "Gokyo Ri",
        "restStop": "Gokyo"
      },
      {
        "day": 8,
        "from": "Gokyo",
        "to": "Dragnag",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Ngozumpa Glacier",
        "restStop": "Dragnag"
      },
      {
        "day": 9,
        "from": "Dragnag",
        "to": "Lobuche",
        "distance": 7,
        "elevationGain": 240,
        "estimatedHours": 6,
        "checkpoint": "Cho La Pass",
        "restStop": "Lobuche"
      },
      {
        "day": 10,
        "from": "Lobuche",
        "to": "Everest Base Camp",
        "distance": 8,
        "elevationGain": 424,
        "estimatedHours": 6,
        "checkpoint": "Gorak Shep",
        "restStop": "Gorak Shep"
      },
      {
        "day": 11,
        "from": "Gorak Shep",
        "to": "Chhukung",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Kala Patthar",
        "restStop": "Dingboche"
      },
      {
        "day": 12,
        "from": "Chhukung",
        "to": "Lobuche",
        "distance": 7,
        "elevationGain": 805,
        "estimatedHours": 7,
        "checkpoint": "Kongma La Pass",
        "restStop": "Lobuche"
      },
      {
        "day": 13,
        "from": "Lobuche",
        "to": "Pheriche",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Thukla",
        "restStop": "Pheriche"
      },
      {
        "day": 14,
        "from": "Pheriche",
        "to": "Namche",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Tengboche",
        "restStop": "Namche"
      },
      {
        "day": 15,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Monjo",
        "restStop": "Lukla"
      },
      {
        "day": 16,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "10",
    "name": "Kongma La Three Passes",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Lukla",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Namche"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Tengboche",
        "distance": 6,
        "elevationGain": 427,
        "estimatedHours": 5,
        "checkpoint": "Khumjung",
        "restStop": "Tengboche"
      },
      {
        "day": 5,
        "from": "Tengboche",
        "to": "Dingboche",
        "distance": 7,
        "elevationGain": 543,
        "estimatedHours": 5,
        "checkpoint": "Pangboche",
        "restStop": "Dingboche"
      },
      {
        "day": 6,
        "from": "Dingboche",
        "to": "Chhukung",
        "distance": 5,
        "elevationGain": 320,
        "estimatedHours": 3,
        "checkpoint": "Ama Dablam View",
        "restStop": "Chhukung"
      },
      {
        "day": 7,
        "from": "Chhukung",
        "to": "Lobuche",
        "distance": 7,
        "elevationGain": 805,
        "estimatedHours": 7,
        "checkpoint": "Kongma La Pass",
        "restStop": "Lobuche"
      },
      {
        "day": 8,
        "from": "Lobuche",
        "to": "Everest Base Camp",
        "distance": 8,
        "elevationGain": 424,
        "estimatedHours": 6,
        "checkpoint": "Gorak Shep",
        "restStop": "Gorak Shep"
      },
      {
        "day": 9,
        "from": "Gorak Shep",
        "to": "Lobuche",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Kala Patthar",
        "restStop": "Lobuche"
      },
      {
        "day": 10,
        "from": "Lobuche",
        "to": "Dragnag",
        "distance": 7,
        "elevationGain": 480,
        "estimatedHours": 6,
        "checkpoint": "Cho La Pass",
        "restStop": "Dragnag"
      },
      {
        "day": 11,
        "from": "Dragnag",
        "to": "Gokyo",
        "distance": 5,
        "elevationGain": 50,
        "estimatedHours": 3,
        "checkpoint": "Glacier Lakes",
        "restStop": "Gokyo"
      },
      {
        "day": 12,
        "from": "Gokyo",
        "to": "Gokyo",
        "distance": 3,
        "elevationGain": 607,
        "estimatedHours": 4,
        "checkpoint": "Gokyo Ri",
        "restStop": "Gokyo"
      },
      {
        "day": 13,
        "from": "Gokyo",
        "to": "Lungden",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Bhote Kosi",
        "restStop": "Lungden"
      },
      {
        "day": 14,
        "from": "Lungden",
        "to": "Thame",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Renjo La Pass",
        "restStop": "Thame"
      },
      {
        "day": 15,
        "from": "Thame",
        "to": "Namche",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Valley Walk",
        "restStop": "Namche"
      },
      {
        "day": 16,
        "from": "Namche",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Monjo",
        "restStop": "Phakding"
      },
      {
        "day": 17,
        "from": "Phakding",
        "to": "Lukla",
        "distance": 6,
        "elevationGain": 230,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi",
        "restStop": "Lukla"
      },
      {
        "day": 18,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "11",
    "name": "Gokyo Valley & Lakes",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Lukla",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Namche"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Dole",
        "distance": 7,
        "elevationGain": 760,
        "estimatedHours": 5,
        "checkpoint": "Khumjung",
        "restStop": "Phortse"
      },
      {
        "day": 5,
        "from": "Dole",
        "to": "Machhermo",
        "distance": 6,
        "elevationGain": 270,
        "estimatedHours": 4,
        "checkpoint": "High Meadow",
        "restStop": "Machhermo"
      },
      {
        "day": 6,
        "from": "Machhermo",
        "to": "Gokyo",
        "distance": 5,
        "elevationGain": 280,
        "estimatedHours": 4,
        "checkpoint": "Sacred Lakes",
        "restStop": "Gokyo"
      },
      {
        "day": 7,
        "from": "Gokyo",
        "to": "Gokyo Ri",
        "distance": 3,
        "elevationGain": 607,
        "estimatedHours": 4,
        "checkpoint": "Summit Ridge",
        "restStop": "Gokyo"
      },
      {
        "day": 8,
        "from": "Gokyo",
        "to": "Gokyo",
        "distance": 4,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Fourth Lake",
        "restStop": "Gokyo"
      },
      {
        "day": 9,
        "from": "Gokyo",
        "to": "Machhermo",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Descent",
        "restStop": "Machhermo"
      },
      {
        "day": 10,
        "from": "Machhermo",
        "to": "Namche",
        "distance": 13,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Dole",
        "restStop": "Namche"
      },
      {
        "day": 11,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Phakding",
        "restStop": "Lukla"
      },
      {
        "day": 12,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "12",
    "name": "Renjo La Pass Viewpoint",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Lukla",
        "to": "Phakding",
        "distance": 6,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Dudh Kosi",
        "restStop": "Phakding"
      },
      {
        "day": 2,
        "from": "Phakding",
        "to": "Namche",
        "distance": 8,
        "elevationGain": 830,
        "estimatedHours": 6,
        "checkpoint": "Hillary Bridge",
        "restStop": "Namche"
      },
      {
        "day": 3,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Namche"
      },
      {
        "day": 4,
        "from": "Namche",
        "to": "Thame",
        "distance": 6,
        "elevationGain": 360,
        "estimatedHours": 4,
        "checkpoint": "Bhote Kosi",
        "restStop": "Thame"
      },
      {
        "day": 5,
        "from": "Thame",
        "to": "Lungden",
        "distance": 7,
        "elevationGain": 580,
        "estimatedHours": 5,
        "checkpoint": "Yak Herding Settlement",
        "restStop": "Lungden"
      },
      {
        "day": 6,
        "from": "Lungden",
        "to": "Gokyo",
        "distance": 8,
        "elevationGain": 1008,
        "estimatedHours": 7,
        "checkpoint": "Renjo La",
        "restStop": "Gokyo"
      },
      {
        "day": 7,
        "from": "Gokyo",
        "to": "Gokyo",
        "distance": 3,
        "elevationGain": 607,
        "estimatedHours": 4,
        "checkpoint": "Gokyo Ri",
        "restStop": "Gokyo"
      },
      {
        "day": 8,
        "from": "Gokyo",
        "to": "Machhermo",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Descent",
        "restStop": "Machhermo"
      },
      {
        "day": 9,
        "from": "Machhermo",
        "to": "Dole",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Alpine Meadow",
        "restStop": "Dole"
      },
      {
        "day": 10,
        "from": "Dole",
        "to": "Namche",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Khumjung",
        "restStop": "Namche"
      },
      {
        "day": 11,
        "from": "Namche",
        "to": "Tengboche",
        "distance": 6,
        "elevationGain": 427,
        "estimatedHours": 4,
        "checkpoint": "Monastery",
        "restStop": "Tengboche"
      },
      {
        "day": 12,
        "from": "Tengboche",
        "to": "Namche",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Khumjung",
        "restStop": "Namche"
      },
      {
        "day": 13,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Phakding",
        "restStop": "Lukla"
      },
      {
        "day": 14,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "13",
    "name": "Langtang Valley Sanctuary",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Syabrubesi",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Drive",
        "restStop": "Syabrubesi"
      },
      {
        "day": 2,
        "from": "Syabrubesi",
        "to": "Lama Hotel",
        "distance": 7,
        "elevationGain": 880,
        "estimatedHours": 5,
        "checkpoint": "Langtang National Park",
        "restStop": "Lama Hotel"
      },
      {
        "day": 3,
        "from": "Lama Hotel",
        "to": "Langtang Village",
        "distance": 8,
        "elevationGain": 1050,
        "estimatedHours": 6,
        "checkpoint": "Ghora Tabela",
        "restStop": "Langtang Village"
      },
      {
        "day": 4,
        "from": "Langtang Village",
        "to": "Kyanjin Gompa",
        "distance": 5,
        "elevationGain": 368,
        "estimatedHours": 3,
        "checkpoint": "Langtang Lirung View",
        "restStop": "Kyanjin Gompa"
      },
      {
        "day": 5,
        "from": "Kyanjin Gompa",
        "to": "Kyanjin Gompa",
        "distance": 4,
        "elevationGain": 1186,
        "estimatedHours": 5,
        "checkpoint": "Tserko Ri",
        "restStop": "Kyanjin Gompa"
      },
      {
        "day": 6,
        "from": "Kyanjin Gompa",
        "to": "Lama Hotel",
        "distance": 13,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Langtang Village",
        "restStop": "Lama Hotel"
      },
      {
        "day": 7,
        "from": "Lama Hotel",
        "to": "Kathmandu",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Syabrubesi",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "14",
    "name": "Langtang & Sacred Lakes",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Syabrubesi",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Drive",
        "restStop": "Syabrubesi"
      },
      {
        "day": 2,
        "from": "Syabrubesi",
        "to": "Lama Hotel",
        "distance": 7,
        "elevationGain": 880,
        "estimatedHours": 5,
        "checkpoint": "National Park",
        "restStop": "Lama Hotel"
      },
      {
        "day": 3,
        "from": "Lama Hotel",
        "to": "Langtang Village",
        "distance": 8,
        "elevationGain": 1050,
        "estimatedHours": 6,
        "checkpoint": "Ghora Tabela",
        "restStop": "Langtang Village"
      },
      {
        "day": 4,
        "from": "Langtang Village",
        "to": "Kyanjin Gompa",
        "distance": 5,
        "elevationGain": 368,
        "estimatedHours": 3,
        "checkpoint": "Monastery",
        "restStop": "Kyanjin Gompa"
      },
      {
        "day": 5,
        "from": "Kyanjin Gompa",
        "to": "Kyanjin Gompa",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Kyanjin Gompa"
      },
      {
        "day": 6,
        "from": "Kyanjin Gompa",
        "to": "Lauribina Yak",
        "distance": 8,
        "elevationGain": 490,
        "estimatedHours": 5,
        "checkpoint": "Singla Pass",
        "restStop": "Lauribina"
      },
      {
        "day": 7,
        "from": "Lauribina Yak",
        "to": "Gosaikunda",
        "distance": 6,
        "elevationGain": 460,
        "estimatedHours": 4,
        "checkpoint": "Alpine Meadow",
        "restStop": "Gosaikunda"
      },
      {
        "day": 8,
        "from": "Gosaikunda",
        "to": "Ghopte",
        "distance": 7,
        "elevationGain": 230,
        "estimatedHours": 5,
        "checkpoint": "Lauribina Pass",
        "restStop": "Ghopte"
      },
      {
        "day": 9,
        "from": "Ghopte",
        "to": "Sundarijal",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Shivapuri Forest",
        "restStop": "Sundarijal"
      },
      {
        "day": 10,
        "from": "Sundarijal",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Drive",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "15",
    "name": "Helambu Cultural Loop",
    "difficulty": "Easy",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Chisapani",
        "distance": 8,
        "elevationGain": 700,
        "estimatedHours": 5,
        "checkpoint": "Sundarijal",
        "restStop": "Chisapani"
      },
      {
        "day": 2,
        "from": "Chisapani",
        "to": "Tharepati",
        "distance": 7,
        "elevationGain": 1296,
        "estimatedHours": 6,
        "checkpoint": "Mangengoth",
        "restStop": "Tharepati"
      },
      {
        "day": 3,
        "from": "Tharepati",
        "to": "Melamchi Gaon",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Alpine Forest",
        "restStop": "Melamchi Gaon"
      },
      {
        "day": 4,
        "from": "Melamchi Gaon",
        "to": "Tarkeghyang",
        "distance": 5,
        "elevationGain": 30,
        "estimatedHours": 3,
        "checkpoint": "Apple Orchards",
        "restStop": "Tarkeghyang"
      },
      {
        "day": 5,
        "from": "Tarkeghyang",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Melamchi Pul",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "16",
    "name": "Helambu Spiritual Trail",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Dhunche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Drive",
        "restStop": "Dhunche"
      },
      {
        "day": 2,
        "from": "Dhunche",
        "to": "Sing Gompa",
        "distance": 7,
        "elevationGain": 1300,
        "estimatedHours": 5,
        "checkpoint": "Rhododendron Forest",
        "restStop": "Sing Gompa"
      },
      {
        "day": 3,
        "from": "Sing Gompa",
        "to": "Gosaikunda",
        "distance": 6,
        "elevationGain": 1130,
        "estimatedHours": 5,
        "checkpoint": "Saraswati Kunda",
        "restStop": "Gosaikunda"
      },
      {
        "day": 4,
        "from": "Gosaikunda",
        "to": "Gosaikunda",
        "distance": 3,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Circumambulation",
        "restStop": "Gosaikunda"
      },
      {
        "day": 5,
        "from": "Gosaikunda",
        "to": "Ghopte",
        "distance": 7,
        "elevationGain": 230,
        "estimatedHours": 5,
        "checkpoint": "Lauribina Pass",
        "restStop": "Ghopte"
      },
      {
        "day": 6,
        "from": "Ghopte",
        "to": "Tharepati",
        "distance": 6,
        "elevationGain": 60,
        "estimatedHours": 4,
        "checkpoint": "Forest Ridge",
        "restStop": "Tharepati"
      },
      {
        "day": 7,
        "from": "Tharepati",
        "to": "Melamchi Gaon",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Hyolmo Village",
        "restStop": "Melamchi Gaon"
      },
      {
        "day": 8,
        "from": "Melamchi Gaon",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Drive",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "17",
    "name": "Manaslu & Tsum Valley",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Arughat",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Drive",
        "restStop": "Arughat"
      },
      {
        "day": 2,
        "from": "Arughat",
        "to": "Soti Khola",
        "distance": 6,
        "elevationGain": 137,
        "estimatedHours": 4,
        "checkpoint": "Budhi Gandaki",
        "restStop": "Soti Khola"
      },
      {
        "day": 3,
        "from": "Soti Khola",
        "to": "Machha Khola",
        "distance": 7,
        "elevationGain": 169,
        "estimatedHours": 5,
        "checkpoint": "Ledge Trail",
        "restStop": "Machha Khola"
      },
      {
        "day": 4,
        "from": "Machha Khola",
        "to": "Tsum Valley Junction",
        "distance": 8,
        "elevationGain": 400,
        "estimatedHours": 5,
        "checkpoint": "Lokpa",
        "restStop": "Lokpa"
      },
      {
        "day": 5,
        "from": "Tsum Junction",
        "to": "Chhokangparo",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 4,
        "checkpoint": "Monastery",
        "restStop": "Chhokangparo"
      },
      {
        "day": 6,
        "from": "Chhokangparo",
        "to": "Mu Gompa",
        "distance": 7,
        "elevationGain": 500,
        "estimatedHours": 5,
        "checkpoint": "Nile",
        "restStop": "Mu Gompa"
      },
      {
        "day": 7,
        "from": "Mu Gompa",
        "to": "Jagat",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Lokpa",
        "restStop": "Jagat"
      },
      {
        "day": 8,
        "from": "Jagat",
        "to": "Deng",
        "distance": 6,
        "elevationGain": 394,
        "estimatedHours": 5,
        "checkpoint": "Bamboo Gorge",
        "restStop": "Deng"
      },
      {
        "day": 9,
        "from": "Deng",
        "to": "Namrung",
        "distance": 8,
        "elevationGain": 826,
        "estimatedHours": 6,
        "checkpoint": "Ghap",
        "restStop": "Namrung"
      },
      {
        "day": 10,
        "from": "Namrung",
        "to": "Samagaon",
        "distance": 7,
        "elevationGain": 900,
        "estimatedHours": 5,
        "checkpoint": "Lho Monastery",
        "restStop": "Samagaon"
      },
      {
        "day": 11,
        "from": "Samagaon",
        "to": "Samagaon",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Samagaon"
      },
      {
        "day": 12,
        "from": "Samagaon",
        "to": "Samdo",
        "distance": 5,
        "elevationGain": 330,
        "estimatedHours": 3,
        "checkpoint": "Tibetan Village",
        "restStop": "Samdo"
      },
      {
        "day": 13,
        "from": "Samdo",
        "to": "Dharmasala",
        "distance": 5,
        "elevationGain": 600,
        "estimatedHours": 4,
        "checkpoint": "Larkya Approach",
        "restStop": "Dharmasala"
      },
      {
        "day": 14,
        "from": "Dharmasala",
        "to": "Bimthang",
        "distance": 10,
        "elevationGain": 646,
        "estimatedHours": 8,
        "checkpoint": "Larkya La Pass",
        "restStop": "Bimthang"
      },
      {
        "day": 15,
        "from": "Bimthang",
        "to": "Tilije",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Apple Orchards",
        "restStop": "Tilije"
      },
      {
        "day": 16,
        "from": "Tilije",
        "to": "Tal",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Marsyangdi Valley",
        "restStop": "Tal"
      },
      {
        "day": 17,
        "from": "Tal",
        "to": "Besisahar",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Road",
        "restStop": "Besisahar"
      },
      {
        "day": 18,
        "from": "Besisahar",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "18",
    "name": "Manaslu Round",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Soti Khola",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Soti Khola"
      },
      {
        "day": 2,
        "from": "Soti Khola",
        "to": "Machha Khola",
        "distance": 7,
        "elevationGain": 169,
        "estimatedHours": 5,
        "checkpoint": "Waterfall Trail",
        "restStop": "Machha Khola"
      },
      {
        "day": 3,
        "from": "Machha Khola",
        "to": "Jagat",
        "distance": 8,
        "elevationGain": 541,
        "estimatedHours": 6,
        "checkpoint": "Suspension Bridges",
        "restStop": "Jagat"
      },
      {
        "day": 4,
        "from": "Jagat",
        "to": "Deng",
        "distance": 6,
        "elevationGain": 394,
        "estimatedHours": 5,
        "checkpoint": "Bamboo Gorge",
        "restStop": "Deng"
      },
      {
        "day": 5,
        "from": "Deng",
        "to": "Namrung",
        "distance": 8,
        "elevationGain": 826,
        "estimatedHours": 6,
        "checkpoint": "Ghap",
        "restStop": "Namrung"
      },
      {
        "day": 6,
        "from": "Namrung",
        "to": "Samagaon",
        "distance": 7,
        "elevationGain": 900,
        "estimatedHours": 5,
        "checkpoint": "Lho Monastery",
        "restStop": "Samagaon"
      },
      {
        "day": 7,
        "from": "Samagaon",
        "to": "Samagaon",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Samagaon"
      },
      {
        "day": 8,
        "from": "Samagaon",
        "to": "Samdo",
        "distance": 5,
        "elevationGain": 330,
        "estimatedHours": 3,
        "checkpoint": "Tibetan Village",
        "restStop": "Samdo"
      },
      {
        "day": 9,
        "from": "Samdo",
        "to": "Dharmasala",
        "distance": 5,
        "elevationGain": 600,
        "estimatedHours": 4,
        "checkpoint": "High Camp",
        "restStop": "Dharmasala"
      },
      {
        "day": 10,
        "from": "Dharmasala",
        "to": "Bimthang",
        "distance": 10,
        "elevationGain": 646,
        "estimatedHours": 8,
        "checkpoint": "Larkya La",
        "restStop": "Bimthang"
      },
      {
        "day": 11,
        "from": "Bimthang",
        "to": "Tilije",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Meadows",
        "restStop": "Tilije"
      },
      {
        "day": 12,
        "from": "Tilije",
        "to": "Dharapani",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Annapurna Circuit",
        "restStop": "Dharapani"
      },
      {
        "day": 13,
        "from": "Dharapani",
        "to": "Besisahar",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Bus",
        "restStop": "Besisahar"
      },
      {
        "day": 14,
        "from": "Besisahar",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "19",
    "name": "Mustang Forbidden Kingdom",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Kagbeni",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Jomsom Flight",
        "restStop": "Kagbeni"
      },
      {
        "day": 2,
        "from": "Kagbeni",
        "to": "Chele",
        "distance": 8,
        "elevationGain": 220,
        "estimatedHours": 5,
        "checkpoint": "Red Canyons",
        "restStop": "Chele"
      },
      {
        "day": 3,
        "from": "Chele",
        "to": "Syangboche",
        "distance": 7,
        "elevationGain": 770,
        "estimatedHours": 6,
        "checkpoint": "Taklam La",
        "restStop": "Syangboche"
      },
      {
        "day": 4,
        "from": "Syangboche",
        "to": "Ghami",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Cliff Monasteries",
        "restStop": "Ghami"
      },
      {
        "day": 5,
        "from": "Ghami",
        "to": "Charang",
        "distance": 6,
        "elevationGain": 40,
        "estimatedHours": 4,
        "checkpoint": "Ghami La",
        "restStop": "Charang"
      },
      {
        "day": 6,
        "from": "Charang",
        "to": "Lo Manthang",
        "distance": 6,
        "elevationGain": 280,
        "estimatedHours": 4,
        "checkpoint": "Walled City",
        "restStop": "Lo Manthang"
      },
      {
        "day": 7,
        "from": "Lo Manthang",
        "to": "Lo Manthang",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Lo Manthang"
      },
      {
        "day": 8,
        "from": "Lo Manthang",
        "to": "Ghami",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Yara Village",
        "restStop": "Ghami"
      },
      {
        "day": 9,
        "from": "Ghami",
        "to": "Tsarang",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Monastery",
        "restStop": "Tsarang"
      },
      {
        "day": 10,
        "from": "Tsarang",
        "to": "Kagbeni",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Canyon",
        "restStop": "Kagbeni"
      },
      {
        "day": 11,
        "from": "Kagbeni",
        "to": "Jomsom",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Kali Gandaki",
        "restStop": "Jomsom"
      },
      {
        "day": 12,
        "from": "Jomsom",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "20",
    "name": "Damodar Kunda Expedition",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Kagbeni",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Jomsom Flight",
        "restStop": "Kagbeni"
      },
      {
        "day": 2,
        "from": "Kagbeni",
        "to": "Chele",
        "distance": 8,
        "elevationGain": 220,
        "estimatedHours": 5,
        "checkpoint": "Red Canyon",
        "restStop": "Chele"
      },
      {
        "day": 3,
        "from": "Chele",
        "to": "Lo Manthang",
        "distance": 12,
        "elevationGain": 810,
        "estimatedHours": 8,
        "checkpoint": "Syangboche",
        "restStop": "Lo Manthang"
      },
      {
        "day": 4,
        "from": "Lo Manthang",
        "to": "Lo Manthang",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Lo Manthang"
      },
      {
        "day": 5,
        "from": "Lo Manthang",
        "to": "Dhi",
        "distance": 8,
        "elevationGain": 210,
        "estimatedHours": 5,
        "checkpoint": "Remote Terrain",
        "restStop": "Dhi"
      },
      {
        "day": 6,
        "from": "Dhi",
        "to": "Ghuma Thanti",
        "distance": 7,
        "elevationGain": 600,
        "estimatedHours": 5,
        "checkpoint": "Desert Plateau",
        "restStop": "Ghuma Thanti"
      },
      {
        "day": 7,
        "from": "Ghuma Thanti",
        "to": "Damodar Base",
        "distance": 6,
        "elevationGain": 250,
        "estimatedHours": 4,
        "checkpoint": "High Plateau",
        "restStop": "Damodar Base"
      },
      {
        "day": 8,
        "from": "Damodar Base",
        "to": "Damodar Kunda",
        "distance": 4,
        "elevationGain": 200,
        "estimatedHours": 3,
        "checkpoint": "Sacred Lakes",
        "restStop": "Damodar Kunda"
      },
      {
        "day": 9,
        "from": "Damodar Base",
        "to": "Ghuma Thanti",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Descent",
        "restStop": "Ghuma Thanti"
      },
      {
        "day": 10,
        "from": "Ghuma Thanti",
        "to": "Lo Manthang",
        "distance": 15,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Dhi",
        "restStop": "Lo Manthang"
      },
      {
        "day": 11,
        "from": "Lo Manthang",
        "to": "Tsarang",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Monastery Route",
        "restStop": "Tsarang"
      },
      {
        "day": 12,
        "from": "Tsarang",
        "to": "Ghami",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Village",
        "restStop": "Ghami"
      },
      {
        "day": 13,
        "from": "Ghami",
        "to": "Chele",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Descent",
        "restStop": "Chele"
      },
      {
        "day": 14,
        "from": "Chele",
        "to": "Kagbeni",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Canyon",
        "restStop": "Kagbeni"
      },
      {
        "day": 15,
        "from": "Kagbeni",
        "to": "Jomsom",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "River Walk",
        "restStop": "Jomsom"
      },
      {
        "day": 16,
        "from": "Jomsom",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "21",
    "name": "Dolpo-Jomsom Wilderness",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Dunai",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Juphal Flight",
        "restStop": "Dunai"
      },
      {
        "day": 2,
        "from": "Dunai",
        "to": "Tarakot",
        "distance": 8,
        "elevationGain": 400,
        "estimatedHours": 5,
        "checkpoint": "Bheri Valley",
        "restStop": "Tarakot"
      },
      {
        "day": 3,
        "from": "Tarakot",
        "to": "Laina Odar",
        "distance": 7,
        "elevationGain": 600,
        "estimatedHours": 5,
        "checkpoint": "Remote Valley",
        "restStop": "Laina Odar"
      },
      {
        "day": 4,
        "from": "Laina Odar",
        "to": "Dho Tarap",
        "distance": 8,
        "elevationGain": 940,
        "estimatedHours": 6,
        "checkpoint": "Tibetan Plateau",
        "restStop": "Dho Tarap"
      },
      {
        "day": 5,
        "from": "Dho Tarap",
        "to": "Dho Tarap",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Dho Tarap"
      },
      {
        "day": 6,
        "from": "Dho Tarap",
        "to": "Numa La Camp",
        "distance": 6,
        "elevationGain": 1110,
        "estimatedHours": 5,
        "checkpoint": "High Plateau",
        "restStop": "Numa La Camp"
      },
      {
        "day": 7,
        "from": "Numa La Camp",
        "to": "Baga La Base",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Numa La Pass",
        "restStop": "Crystal Mountain Camp"
      },
      {
        "day": 8,
        "from": "Baga La Base",
        "to": "Phoksundo Lake",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Baga La Pass",
        "restStop": "Ringmo"
      },
      {
        "day": 9,
        "from": "Phoksundo",
        "to": "Phoksundo",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Phoksundo Lake"
      },
      {
        "day": 10,
        "from": "Phoksundo",
        "to": "Pungmo",
        "distance": 8,
        "elevationGain": 400,
        "estimatedHours": 5,
        "checkpoint": "Waterfall",
        "restStop": "Pungmo"
      },
      {
        "day": 11,
        "from": "Pungmo",
        "to": "Saldang",
        "distance": 7,
        "elevationGain": 300,
        "estimatedHours": 5,
        "checkpoint": "Trans-Himalayan",
        "restStop": "Saldang"
      },
      {
        "day": 12,
        "from": "Saldang",
        "to": "Namgung",
        "distance": 6,
        "elevationGain": 230,
        "estimatedHours": 4,
        "checkpoint": "Nanzang Valley",
        "restStop": "Namgung"
      },
      {
        "day": 13,
        "from": "Namgung",
        "to": "Kang La Camp",
        "distance": 5,
        "elevationGain": 1160,
        "estimatedHours": 5,
        "checkpoint": "High Pass Approach",
        "restStop": "Kang La Camp"
      },
      {
        "day": 14,
        "from": "Kang La Camp",
        "to": "Bhijer",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Kang La Pass",
        "restStop": "Bhijer"
      },
      {
        "day": 15,
        "from": "Bhijer",
        "to": "Lo Manthang Area",
        "distance": 8,
        "elevationGain": 200,
        "estimatedHours": 5,
        "checkpoint": "Mustang Plateau",
        "restStop": "Mustang Camp"
      },
      {
        "day": 16,
        "from": "Mustang",
        "to": "Chele",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Eroded Canyon",
        "restStop": "Chele"
      },
      {
        "day": 17,
        "from": "Chele",
        "to": "Jomsom",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Kagbeni",
        "restStop": "Jomsom"
      },
      {
        "day": 18,
        "from": "Jomsom",
        "to": "Jomsom",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Rest",
        "restStop": "Jomsom"
      },
      {
        "day": 19,
        "from": "Jomsom",
        "to": "Jomsom",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Buffer",
        "restStop": "Jomsom"
      },
      {
        "day": 20,
        "from": "Jomsom",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "22",
    "name": "Lower Dolpo Jewels",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Dunai",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Juphal Flight",
        "restStop": "Dunai"
      },
      {
        "day": 2,
        "from": "Dunai",
        "to": "Ankhe",
        "distance": 6,
        "elevationGain": 460,
        "estimatedHours": 4,
        "checkpoint": "Bheri Gorge",
        "restStop": "Ankhe"
      },
      {
        "day": 3,
        "from": "Ankhe",
        "to": "Chhepka",
        "distance": 7,
        "elevationGain": 240,
        "estimatedHours": 5,
        "checkpoint": "Waterfall",
        "restStop": "Chhepka"
      },
      {
        "day": 4,
        "from": "Chhepka",
        "to": "Phoksundo Lake",
        "distance": 6,
        "elevationGain": 772,
        "estimatedHours": 5,
        "checkpoint": "Phoksundo Waterfall",
        "restStop": "Ringmo"
      },
      {
        "day": 5,
        "from": "Phoksundo",
        "to": "Phoksundo",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Lake Exploration",
        "restStop": "Phoksundo Lake"
      },
      {
        "day": 6,
        "from": "Ringmo",
        "to": "Phoksundo Base",
        "distance": 5,
        "elevationGain": 588,
        "estimatedHours": 4,
        "checkpoint": "Lake Head",
        "restStop": "Base Camp"
      },
      {
        "day": 7,
        "from": "Base Camp",
        "to": "Kagmara Camp",
        "distance": 5,
        "elevationGain": 400,
        "estimatedHours": 4,
        "checkpoint": "Upper Valley",
        "restStop": "Kagmara Camp"
      },
      {
        "day": 8,
        "from": "Kagmara Camp",
        "to": "Pungmo",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Kagmara La Pass",
        "restStop": "Pungmo"
      },
      {
        "day": 9,
        "from": "Pungmo",
        "to": "Rimi",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Remote Valley",
        "restStop": "Rimi"
      },
      {
        "day": 10,
        "from": "Rimi",
        "to": "Rohagaon",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Village Trail",
        "restStop": "Rohagaon"
      },
      {
        "day": 11,
        "from": "Rohagaon",
        "to": "Ghargyul",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Circuit Return",
        "restStop": "Ghargyul"
      },
      {
        "day": 12,
        "from": "Ghargyul",
        "to": "Taka",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Lower Valley",
        "restStop": "Taka"
      },
      {
        "day": 13,
        "from": "Taka",
        "to": "Kaigaon",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Monastery",
        "restStop": "Kaigaon"
      },
      {
        "day": 14,
        "from": "Kaigaon",
        "to": "Tarakot",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Bheri Valley",
        "restStop": "Tarakot"
      },
      {
        "day": 15,
        "from": "Tarakot",
        "to": "Dunai",
        "distance": 8,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Descent",
        "restStop": "Dunai"
      },
      {
        "day": 16,
        "from": "Dunai",
        "to": "Dunai",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Rest",
        "restStop": "Dunai"
      },
      {
        "day": 17,
        "from": "Dunai",
        "to": "Dunai",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Buffer",
        "restStop": "Dunai"
      },
      {
        "day": 18,
        "from": "Dunai",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "23",
    "name": "Mardi Forest Explorer",
    "difficulty": "Easy",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Forest Camp",
        "distance": 7,
        "elevationGain": 1490,
        "estimatedHours": 6,
        "checkpoint": "Kande",
        "restStop": "Forest Camp"
      },
      {
        "day": 2,
        "from": "Forest Camp",
        "to": "Low Camp",
        "distance": 4,
        "elevationGain": 460,
        "estimatedHours": 3,
        "checkpoint": "Ridge View",
        "restStop": "Low Camp"
      },
      {
        "day": 3,
        "from": "Low Camp",
        "to": "Pokhara",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Phedi",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "24",
    "name": "Mardi Himal Sky Base",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Forest Camp",
        "distance": 7,
        "elevationGain": 1490,
        "estimatedHours": 6,
        "checkpoint": "Kande",
        "restStop": "Forest Camp"
      },
      {
        "day": 2,
        "from": "Forest Camp",
        "to": "High Camp",
        "distance": 5,
        "elevationGain": 990,
        "estimatedHours": 5,
        "checkpoint": "Low Camp",
        "restStop": "High Camp"
      },
      {
        "day": 3,
        "from": "High Camp",
        "to": "Sidhing",
        "distance": 8,
        "elevationGain": 620,
        "estimatedHours": 7,
        "checkpoint": "Mardi Base Camp",
        "restStop": "Sidhing"
      },
      {
        "day": 4,
        "from": "Sidhing",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Drive",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "25",
    "name": "Dhaulagiri High Base Camp",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Babiyachaur",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Beni Drive",
        "restStop": "Babiyachaur"
      },
      {
        "day": 2,
        "from": "Babiyachaur",
        "to": "Muri",
        "distance": 7,
        "elevationGain": 800,
        "estimatedHours": 5,
        "checkpoint": "Myagdi Valley",
        "restStop": "Muri"
      },
      {
        "day": 3,
        "from": "Muri",
        "to": "Boghara",
        "distance": 8,
        "elevationGain": 700,
        "estimatedHours": 6,
        "checkpoint": "Narrow Gorge",
        "restStop": "Boghara"
      },
      {
        "day": 4,
        "from": "Boghara",
        "to": "Jaljala Kharka",
        "distance": 7,
        "elevationGain": 1300,
        "estimatedHours": 6,
        "checkpoint": "Rhododendron Forest",
        "restStop": "Jaljala"
      },
      {
        "day": 5,
        "from": "Jaljala",
        "to": "Dampus Pass",
        "distance": 6,
        "elevationGain": 350,
        "estimatedHours": 5,
        "checkpoint": "Dhaulagiri View",
        "restStop": "Dampus Camp"
      },
      {
        "day": 6,
        "from": "Dampus",
        "to": "French Pass Camp",
        "distance": 6,
        "elevationGain": 690,
        "estimatedHours": 5,
        "checkpoint": "Glacial Moraine",
        "restStop": "French Camp"
      },
      {
        "day": 7,
        "from": "French Camp",
        "to": "Dhaulagiri BC",
        "distance": 5,
        "elevationGain": 280,
        "estimatedHours": 5,
        "checkpoint": "French Pass",
        "restStop": "Base Camp"
      },
      {
        "day": 8,
        "from": "Base Camp",
        "to": "Base Camp",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Base Camp"
      },
      {
        "day": 9,
        "from": "Base Camp",
        "to": "Dampus Pass",
        "distance": 11,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "French Pass",
        "restStop": "Dampus"
      },
      {
        "day": 10,
        "from": "Dampus",
        "to": "Jaljala Kharka",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Descent",
        "restStop": "Jaljala"
      },
      {
        "day": 11,
        "from": "Jaljala",
        "to": "Boghara",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Forest",
        "restStop": "Boghara"
      },
      {
        "day": 12,
        "from": "Boghara",
        "to": "Pokhara",
        "distance": 15,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Beni",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "26",
    "name": "Dhaulagiri Hidden Wilderness",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Pokhara",
        "to": "Babiyachaur",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Beni Drive",
        "restStop": "Babiyachaur"
      },
      {
        "day": 2,
        "from": "Babiyachaur",
        "to": "Muri",
        "distance": 7,
        "elevationGain": 800,
        "estimatedHours": 5,
        "checkpoint": "Myagdi Valley",
        "restStop": "Muri"
      },
      {
        "day": 3,
        "from": "Muri",
        "to": "Boghara",
        "distance": 8,
        "elevationGain": 700,
        "estimatedHours": 6,
        "checkpoint": "Gorge",
        "restStop": "Boghara"
      },
      {
        "day": 4,
        "from": "Boghara",
        "to": "Jaljala",
        "distance": 7,
        "elevationGain": 1300,
        "estimatedHours": 6,
        "checkpoint": "Forest",
        "restStop": "Jaljala"
      },
      {
        "day": 5,
        "from": "Jaljala",
        "to": "Dampus Pass",
        "distance": 6,
        "elevationGain": 350,
        "estimatedHours": 5,
        "checkpoint": "Dhaulagiri View",
        "restStop": "Dampus"
      },
      {
        "day": 6,
        "from": "Dampus",
        "to": "French Camp",
        "distance": 6,
        "elevationGain": 690,
        "estimatedHours": 5,
        "checkpoint": "Moraine",
        "restStop": "French Camp"
      },
      {
        "day": 7,
        "from": "French Camp",
        "to": "Hidden Valley",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "French Pass",
        "restStop": "Hidden Valley"
      },
      {
        "day": 8,
        "from": "Hidden Valley",
        "to": "Hidden Valley",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Hidden Valley"
      },
      {
        "day": 9,
        "from": "Hidden Valley",
        "to": "Dhaulagiri BC",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Glacier",
        "restStop": "Base Camp"
      },
      {
        "day": 10,
        "from": "BC",
        "to": "East Col",
        "distance": 5,
        "elevationGain": 610,
        "estimatedHours": 5,
        "checkpoint": "Col Approach",
        "restStop": "East Col Camp"
      },
      {
        "day": 11,
        "from": "East Col",
        "to": "BC",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "East Col Summit",
        "restStop": "Base Camp"
      },
      {
        "day": 12,
        "from": "BC",
        "to": "Chhonbardan Glacier",
        "distance": 8,
        "elevationGain": 200,
        "estimatedHours": 6,
        "checkpoint": "Glacier Crossing",
        "restStop": "Glacier Camp"
      },
      {
        "day": 13,
        "from": "Glacier",
        "to": "Marpha",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Glacier Descent",
        "restStop": "Marpha"
      },
      {
        "day": 14,
        "from": "Marpha",
        "to": "Jomsom",
        "distance": 5,
        "elevationGain": 50,
        "estimatedHours": 2,
        "checkpoint": "Apple Village",
        "restStop": "Jomsom"
      },
      {
        "day": 15,
        "from": "Jomsom",
        "to": "Jomsom",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Rest",
        "restStop": "Jomsom"
      },
      {
        "day": 16,
        "from": "Jomsom",
        "to": "Pokhara",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Pokhara"
      }
    ]
  },
  {
    "trekId": "27",
    "name": "Rolwaling Alpine Pass",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Simigaon",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Simigaon"
      },
      {
        "day": 2,
        "from": "Simigaon",
        "to": "Dongang",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 4,
        "checkpoint": "Farmland",
        "restStop": "Dongang"
      },
      {
        "day": 3,
        "from": "Dongang",
        "to": "Beding",
        "distance": 7,
        "elevationGain": 1200,
        "estimatedHours": 6,
        "checkpoint": "Rolwaling Khola",
        "restStop": "Beding"
      },
      {
        "day": 4,
        "from": "Beding",
        "to": "Na",
        "distance": 5,
        "elevationGain": 480,
        "estimatedHours": 4,
        "checkpoint": "Yak Herders",
        "restStop": "Na"
      },
      {
        "day": 5,
        "from": "Na",
        "to": "Na",
        "distance": 4,
        "elevationGain": 400,
        "estimatedHours": 4,
        "checkpoint": "Tsho Rolpa Lake",
        "restStop": "Na"
      },
      {
        "day": 6,
        "from": "Na",
        "to": "Tashi Lapcha Camp",
        "distance": 5,
        "elevationGain": 1020,
        "estimatedHours": 5,
        "checkpoint": "Trakarding Glacier",
        "restStop": "High Camp"
      },
      {
        "day": 7,
        "from": "Camp",
        "to": "Thame",
        "distance": 8,
        "elevationGain": 555,
        "estimatedHours": 8,
        "checkpoint": "Tashi Lapcha Pass",
        "restStop": "Thame"
      },
      {
        "day": 8,
        "from": "Thame",
        "to": "Namche",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Sherpa Village",
        "restStop": "Namche"
      },
      {
        "day": 9,
        "from": "Namche",
        "to": "Namche",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Rest",
        "restStop": "Namche"
      },
      {
        "day": 10,
        "from": "Namche",
        "to": "Tengboche",
        "distance": 6,
        "elevationGain": 427,
        "estimatedHours": 4,
        "checkpoint": "Monastery",
        "restStop": "Tengboche"
      },
      {
        "day": 11,
        "from": "Tengboche",
        "to": "Namche",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Ama Dablam View",
        "restStop": "Namche"
      },
      {
        "day": 12,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Phakding",
        "restStop": "Lukla"
      },
      {
        "day": 13,
        "from": "Lukla",
        "to": "Lukla",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Buffer",
        "restStop": "Lukla"
      },
      {
        "day": 14,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "28",
    "name": "Rolwaling Hidden Valley",
    "difficulty": "Moderate",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Simigaon",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Simigaon"
      },
      {
        "day": 2,
        "from": "Simigaon",
        "to": "Dongang",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 4,
        "checkpoint": "Farmland",
        "restStop": "Dongang"
      },
      {
        "day": 3,
        "from": "Dongang",
        "to": "Beding",
        "distance": 7,
        "elevationGain": 1200,
        "estimatedHours": 6,
        "checkpoint": "Rolwaling Khola",
        "restStop": "Beding"
      },
      {
        "day": 4,
        "from": "Beding",
        "to": "Beding",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Beding"
      },
      {
        "day": 5,
        "from": "Beding",
        "to": "Na",
        "distance": 5,
        "elevationGain": 480,
        "estimatedHours": 4,
        "checkpoint": "Yak Pasture",
        "restStop": "Na"
      },
      {
        "day": 6,
        "from": "Na",
        "to": "Tsho Rolpa",
        "distance": 4,
        "elevationGain": 400,
        "estimatedHours": 4,
        "checkpoint": "Glacial Lake",
        "restStop": "Tsho Rolpa"
      },
      {
        "day": 7,
        "from": "Tsho Rolpa",
        "to": "Na",
        "distance": 4,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Return",
        "restStop": "Na"
      },
      {
        "day": 8,
        "from": "Na",
        "to": "Beding",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Descent",
        "restStop": "Beding"
      },
      {
        "day": 9,
        "from": "Beding",
        "to": "Simigaon",
        "distance": 13,
        "elevationGain": 0,
        "estimatedHours": 7,
        "checkpoint": "Forest",
        "restStop": "Simigaon"
      },
      {
        "day": 10,
        "from": "Simigaon",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 8,
        "checkpoint": "Drive",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "29",
    "name": "Makalu Sherpani Col Route",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Num",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Tumlingtar Flight",
        "restStop": "Num"
      },
      {
        "day": 2,
        "from": "Num",
        "to": "Seduwa",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 5,
        "checkpoint": "Arun River Bridge",
        "restStop": "Seduwa"
      },
      {
        "day": 3,
        "from": "Seduwa",
        "to": "Tashigaon",
        "distance": 7,
        "elevationGain": 880,
        "estimatedHours": 6,
        "checkpoint": "Terraced Hills",
        "restStop": "Tashigaon"
      },
      {
        "day": 4,
        "from": "Tashigaon",
        "to": "Khongma",
        "distance": 6,
        "elevationGain": 1460,
        "estimatedHours": 6,
        "checkpoint": "Rhododendron Forest",
        "restStop": "Khongma"
      },
      {
        "day": 5,
        "from": "Khongma",
        "to": "Dobate",
        "distance": 5,
        "elevationGain": 630,
        "estimatedHours": 4,
        "checkpoint": "Alpine Zone",
        "restStop": "Dobate"
      },
      {
        "day": 6,
        "from": "Dobate",
        "to": "BC Approach",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 5,
        "checkpoint": "Barun Valley",
        "restStop": "Approach Camp"
      },
      {
        "day": 7,
        "from": "Approach",
        "to": "Makalu BC",
        "distance": 5,
        "elevationGain": 180,
        "estimatedHours": 4,
        "checkpoint": "Makalu View",
        "restStop": "Makalu Base Camp"
      },
      {
        "day": 8,
        "from": "BC",
        "to": "BC",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Makalu BC"
      },
      {
        "day": 9,
        "from": "BC",
        "to": "Sherpani Advance",
        "distance": 6,
        "elevationGain": 930,
        "estimatedHours": 6,
        "checkpoint": "West Barun Glacier",
        "restStop": "Advance Camp"
      },
      {
        "day": 10,
        "from": "Advance",
        "to": "Sherpani Camp",
        "distance": 4,
        "elevationGain": 300,
        "estimatedHours": 4,
        "checkpoint": "Glacier Camp",
        "restStop": "Sherpani Camp"
      },
      {
        "day": 11,
        "from": "Sherpani",
        "to": "Sherpani Col",
        "distance": 3,
        "elevationGain": 335,
        "estimatedHours": 5,
        "checkpoint": "Technical Climb",
        "restStop": "Col Camp"
      },
      {
        "day": 12,
        "from": "Col Camp",
        "to": "West Col",
        "distance": 4,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "West Col Crossing",
        "restStop": "West Col Camp"
      },
      {
        "day": 13,
        "from": "West Col",
        "to": "Amphu Lapcha",
        "distance": 6,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Descent",
        "restStop": "Amphu Camp"
      },
      {
        "day": 14,
        "from": "Amphu",
        "to": "Chhukung",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Amphu Lapcha",
        "restStop": "Chhukung"
      },
      {
        "day": 15,
        "from": "Chhukung",
        "to": "Dingboche",
        "distance": 5,
        "elevationGain": 0,
        "estimatedHours": 3,
        "checkpoint": "Valley",
        "restStop": "Dingboche"
      },
      {
        "day": 16,
        "from": "Dingboche",
        "to": "Namche",
        "distance": 12,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Tengboche",
        "restStop": "Namche"
      },
      {
        "day": 17,
        "from": "Namche",
        "to": "Lukla",
        "distance": 10,
        "elevationGain": 0,
        "estimatedHours": 5,
        "checkpoint": "Phakding",
        "restStop": "Lukla"
      },
      {
        "day": 18,
        "from": "Lukla",
        "to": "Lukla",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Buffer",
        "restStop": "Lukla"
      },
      {
        "day": 19,
        "from": "Lukla",
        "to": "Lukla",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Rest",
        "restStop": "Lukla"
      },
      {
        "day": 20,
        "from": "Lukla",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 1,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  },
  {
    "trekId": "30",
    "name": "Makalu Base Camp Classic",
    "difficulty": "Hard",
    "routeStages": [
      {
        "day": 1,
        "from": "Kathmandu",
        "to": "Num",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Tumlingtar Flight",
        "restStop": "Num"
      },
      {
        "day": 2,
        "from": "Num",
        "to": "Seduwa",
        "distance": 6,
        "elevationGain": 500,
        "estimatedHours": 5,
        "checkpoint": "Arun River Bridge",
        "restStop": "Seduwa"
      },
      {
        "day": 3,
        "from": "Seduwa",
        "to": "Tashigaon",
        "distance": 7,
        "elevationGain": 880,
        "estimatedHours": 6,
        "checkpoint": "Terraced Hills",
        "restStop": "Tashigaon"
      },
      {
        "day": 4,
        "from": "Tashigaon",
        "to": "Khongma",
        "distance": 6,
        "elevationGain": 1460,
        "estimatedHours": 6,
        "checkpoint": "Rhododendron Forest",
        "restStop": "Khongma"
      },
      {
        "day": 5,
        "from": "Khongma",
        "to": "Dobate",
        "distance": 5,
        "elevationGain": 630,
        "estimatedHours": 4,
        "checkpoint": "Alpine Zone",
        "restStop": "Dobate"
      },
      {
        "day": 6,
        "from": "Dobate",
        "to": "Yangla Kharka",
        "distance": 6,
        "elevationGain": 300,
        "estimatedHours": 4,
        "checkpoint": "Barun Valley",
        "restStop": "Yangla Kharka"
      },
      {
        "day": 7,
        "from": "Yangla",
        "to": "Makalu BC",
        "distance": 5,
        "elevationGain": 510,
        "estimatedHours": 5,
        "checkpoint": "Glacier Moraine",
        "restStop": "Makalu Base Camp"
      },
      {
        "day": 8,
        "from": "BC",
        "to": "BC",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Exploration",
        "restStop": "Makalu BC"
      },
      {
        "day": 9,
        "from": "BC",
        "to": "BC",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 0,
        "checkpoint": "Acclimatization",
        "restStop": "Makalu BC"
      },
      {
        "day": 10,
        "from": "BC",
        "to": "Dobate",
        "distance": 11,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Descent",
        "restStop": "Dobate"
      },
      {
        "day": 11,
        "from": "Dobate",
        "to": "Tashigaon",
        "distance": 11,
        "elevationGain": 0,
        "estimatedHours": 6,
        "checkpoint": "Forest",
        "restStop": "Tashigaon"
      },
      {
        "day": 12,
        "from": "Tashigaon",
        "to": "Seduwa",
        "distance": 7,
        "elevationGain": 0,
        "estimatedHours": 4,
        "checkpoint": "Arun Valley",
        "restStop": "Seduwa"
      },
      {
        "day": 13,
        "from": "Seduwa",
        "to": "Num",
        "distance": 6,
        "elevationGain": 320,
        "estimatedHours": 4,
        "checkpoint": "River Bridge",
        "restStop": "Num"
      },
      {
        "day": 14,
        "from": "Num",
        "to": "Kathmandu",
        "distance": 0,
        "elevationGain": 0,
        "estimatedHours": 2,
        "checkpoint": "Flight",
        "restStop": "Kathmandu"
      }
    ]
  }
];

export const TREK_ROUTE_BY_ID: Map<string, TrekRoute> = new Map(
  TREK_ROUTES.map(t => [t.trekId, t]),
);

/** Distinct place names across all route stages (for location autocomplete). */
export function allLocations(): string[] {
  const set = new Set<string>();
  for (const t of TREK_ROUTES) {
    for (const s of t.routeStages) {
      if (s.from) set.add(s.from);
      if (s.to) set.add(s.to);
      if (s.checkpoint) set.add(s.checkpoint);
      if (s.restStop) set.add(s.restStop);
    }
  }
  return Array.from(set).sort();
}
