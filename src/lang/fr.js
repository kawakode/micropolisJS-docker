/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The French translation (see I18n): each English text, and its translation. Spaces before high punctuation are
// made unbreakable when the text is shown (see I18n.typeset), so they are written as ordinary spaces here.
//
// The jokes of the news ticker are written anew rather than translated (see TickerNews): there are jokes on the same
// topics as in English, with the same placeholders.

var strings = {
  // The heads-up display
  'Date': 'Date',
  'Time': 'Heure',
  'Funds': 'Fonds',
  'Population': 'Habitants',
  'Score': 'Score',
  'Budget': 'Budget',
  'Evaluation': 'Bilan',
  'Graphs': 'Courbes',
  'More': 'Plus',
  'Disasters': 'Catastrophes',
  'Picture': 'Photo',
  'About': 'À propos',
  'Settings': 'Paramètres',
  'Save': 'Sauver',
  'Pause': 'Pause',
  'Play': 'Jouer',
  'Pause or resume (Space)': 'Pause ou reprise (Espace)',
  'Slow': 'Lente',
  'Normal': 'Normale',
  'Fast': 'Rapide',
  'Simulation speed': 'Vitesse de la simulation',
  'Game menu': 'Menu du jeu',
  'Zoom': 'Zoom',
  'Zoom in': 'Zoomer',
  'Zoom out': 'Dézoomer',
  'Zoom in (+)': 'Zoomer (+)',
  'Zoom out (-)': 'Dézoomer (-)',
  'Live': 'En direct',
  'Close': 'Fermer',
  'City news': 'Actualités de la ville',
  'Show on the map': 'Voir sur la carte',

  // The title screen
  'Loading…': 'Chargement…',
  'Build the city of your dreams, right in your browser.': 'Bâtissez la ville de vos rêves, directement dans votre navigateur.',
  'Play this map': 'Jouer sur cette carte',
  'Generate another': 'En générer une autre',
  'Map options': 'Options de la carte',
  'Land': 'Terrain',
  'Random': 'Au hasard',
  'Mainland': 'Continent',
  'Island': 'Île',
  'Water': 'Eau',
  'Dry': 'Pas d\'eau',
  'A river': 'Une rivière',
  'Lakes': 'Des lacs',
  'Forests': 'Forêts',
  'None': 'Aucune',
  'Few': 'Quelques-unes',
  'Many': 'Beaucoup',
  'Wild': 'Partout',
  'Scenarios & cities': 'Scénarios et villes',
  'Load saved game': 'Charger la partie sauvée',
  'Open a city file…': 'Ouvrir un fichier de ville…',
  'Drag to build roads and zones, right-drag or use the arrow keys to move around, and the mouse wheel to zoom.':
    'Faites glisser pour tracer routes et zones, glissez avec le clic droit ou utilisez les flèches pour vous déplacer, et la molette pour zoomer.',
  'credits': 'KawaCity par <a href="https://github.com/kawakode" target="_blank" rel="noopener">kawakode</a>, d\'après <a href="https://github.com/graememcc/micropolisJS" target="_blank" rel="noopener">micropolisJS</a> de <a href="http://www.graememcc.co.uk" target="_blank" rel="noopener">Graeme McCutcheon</a> et ses <a href="https://github.com/graememcc/micropolisJS/graphs/contributors" target="_blank" rel="noopener">contributeurs</a>, un portage du simulateur de ville libre Micropolis. &middot; <a href="about.html" target="_blank" rel="noopener">À propos</a> &middot; <a href="https://github.com/kawakode/micropolisJS-docker" target="_blank" rel="noopener">GitHub</a>',
  'Show': 'Afficher',
  'Scenarios': 'Scénarios',
  'Cities': 'Villes',
  'Back': 'Retour',
  'Play this city': 'Jouer cette ville',
  'Play this scenario': 'Jouer ce scénario',
  'An untouched landscape, waiting for its first settlers.': 'Un paysage intact, qui attend ses premiers habitants.',
  'In {year}, {population} people live here, and the city has {funds} in the bank.':
    'En {year}, {population} personnes vivent ici, et la ville a {funds} en caisse.',
  'New city': 'Nouvelle ville',
  'City name': 'Nom de la ville',
  'Max. 15 letters': '15 lettres max.',
  'Difficulty': 'Difficulté',
  'Easy': 'Facile',
  'Medium': 'Moyen',
  'Hard': 'Difficile',
  'Found the city': 'Fonder la ville',
  'Uh-oh!': 'Oups !',
  'This window is too small to fit the city and all the controls. Try a bigger window, or rotating your device.':
    'Cette fenêtre est trop petite pour afficher la ville et toutes les commandes. Agrandissez-la, ou tournez votre appareil.',
  'Sorry, KawaCity can\'t open this file. Choose a city saved from KawaCity, or a city file (.cty) of the original game.':
    'Désolé, KawaCity ne peut pas ouvrir ce fichier. Choisissez une ville sauvée depuis KawaCity, ou un fichier de ville (.cty) du jeu original.',
  'Sorry, the file could not be read.': 'Désolé, le fichier n\'a pas pu être lu.',
  'Sorry, the city could not be loaded.': 'Désolé, la ville n\'a pas pu être chargée.',
  'Failed to load tileset!': 'Impossible de charger les images du jeu !',

  // The tool bar
  'Tools': 'Outils',
  'Query': 'Infos',
  'Residential': 'Résidentiel',
  'Commercial': 'Commercial',
  'Industrial': 'Industriel',
  'Residential zone': 'Zone résidentielle',
  'Commercial zone': 'Zone commerciale',
  'Industrial zone': 'Zone industrielle',
  'Bulldozer': 'Bulldozer',
  'Transport': 'Transports',
  'Power': 'Énergie',
  'Services': 'Services',
  'Leisure': 'Loisirs',
  'Terrain': 'Terrain',
  'Bulldozer 1x1': 'Bulldozer 1x1',
  'Bulldozer 3x3': 'Bulldozer 3x3',
  'Bulldozer 5x5': 'Bulldozer 5x5',
  'Bulldozer 7x7': 'Bulldozer 7x7',
  'Clears a tile, or the area you drag over. Click any tile of a building to demolish it all.':
    'Rase une case, ou la zone que vous parcourez. Cliquez sur n\'importe quelle case d\'un bâtiment pour le démolir entièrement.',
  'Clears 3x3 tiles around the cursor: drag it like a brush. $1 a tile.':
    'Rase 3x3 cases autour du curseur : promenez-le comme un pinceau. 1 $ la case.',
  'Clears 5x5 tiles around the cursor. Press B again to change size.':
    'Rase 5x5 cases autour du curseur. Appuyez encore sur B pour changer de taille.',
  'Clears 7x7 tiles around the cursor: for wide demolitions.': 'Rase 7x7 cases autour du curseur : pour les grandes démolitions.',
  'Street': 'Rue',
  'The ordinary road. Bridges water for $50 a tile.': 'La route ordinaire. Franchit l\'eau pour 50 $ la case.',
  'Dirt road': 'Chemin de terre',
  'Cheap and nearly free to keep up, but it jams quickly, slows trips down and can\'t cross water.':
    'Bon marché et presque gratuit à entretenir, mais vite bouché ; il ralentit les trajets et ne franchit pas l\'eau.',
  'Avenue': 'Avenue',
  'Carries twice the traffic of a street. Twice the upkeep.': 'Deux fois plus de trafic qu\'une rue. Deux fois plus d\'entretien.',
  'Highway': 'Autoroute',
  'Carries four times the traffic, and trips go twice as far. No access to buildings beside it: join it from other roads.':
    'Quatre fois plus de trafic, et des trajets deux fois plus longs. Pas d\'accès aux bâtiments qui la bordent : rejoignez-la depuis d\'autres routes.',
  'Rail': 'Voie ferrée',
  'Mass transit: trips use it without jamming the roads.': 'Transport en commun : les trajets l\'empruntent sans boucher les routes.',
  'Seaport': 'Port',
  'Industry needs one to grow beyond a small town.': 'L\'industrie en a besoin pour dépasser la taille d\'un bourg.',
  'Airport': 'Aéroport',
  'Commerce needs one to grow beyond a large city.': 'Le commerce en a besoin pour dépasser la taille d\'une grande ville.',
  'Power line': 'Ligne électrique',
  'Carries power to zones that don\'t touch a powered zone.': 'Amène le courant aux zones qui ne touchent pas une zone alimentée.',
  'Wind turbine': 'Éolienne',
  '50 MW, clean. Build them in fields.': '50 MW, propre. À construire en pleine campagne.',
  'Solar farm': 'Centrale solaire',
  '250 MW, clean.': '250 MW, propre.',
  'Gas plant': 'Centrale à gaz',
  '500 MW, a little pollution.': '500 MW, un peu polluante.',
  'Coal plant': 'Centrale à charbon',
  '700 MW, heavy pollution.': '700 MW, très polluante.',
  'Nuclear plant': 'Centrale nucléaire',
  '2000 MW, clean, but it may melt down.': '2000 MW, propre, mais son cœur peut fondre.',
  'tool|Police': 'Commissariat',
  'Lowers crime around it. $100 a year.': 'Fait baisser la criminalité alentour. 100 $ par an.',
  'Fire station': 'Caserne',
  'Puts fires out faster around it. $100 a year.': 'Éteint plus vite les incendies alentour. 100 $ par an.',
  'School': 'École',
  'Raises land values and lowers crime nearby.': 'Fait monter les prix fonciers et baisser la criminalité alentour.',
  'University': 'Université',
  'Like a school, twice as strong and further reaching.': 'Comme une école, deux fois plus efficace, et de plus loin.',
  'Park': 'Parc',
  'A few trees or a fountain: raises land values.': 'Quelques arbres ou une fontaine : fait monter les prix fonciers.',
  'Garden': 'Jardin',
  'Flower beds: raise land values a little more.': 'Des massifs de fleurs : font monter les prix fonciers un peu plus.',
  'Plaza': 'Place',
  'A paved square with a fountain, for city centres.': 'Une place pavée avec une fontaine, pour les centres-villes.',
  'Big park': 'Grand parc',
  'Lawns, trees and a pond: a boost to land values around it.': 'Pelouses, arbres et étang : un coup de pouce aux prix fonciers alentour.',
  'Stadium': 'Stade',
  'Residents need one as the city grows.': 'Les habitants en réclament un quand la ville grandit.',
  'Trees': 'Arbres',
  'Plant a forest on bare land.': 'Plantez une forêt sur un terrain nu.',
  'Dig water': 'Creuser',
  'Dig a lake or a canal.': 'Creusez un lac ou un canal.',
  'Landfill': 'Remblai',
  'Fill water in, to build on it.': 'Comblez l\'eau pour bâtir dessus.',
  'Insufficient funds to build that': 'Fonds insuffisants pour construire ça',
  'Area must be bulldozed first': 'Il faut d\'abord raser le terrain',
  'Bulldoze first (automatic bulldozing is off)': 'Rasez d\'abord (le bulldozer automatique est désactivé)',
  '{cost} (not enough funds)': '{cost} (fonds insuffisants)',

  // The side panel
  'City overview': 'Vue d\'ensemble',
  'Map overlay': 'Calque de la carte',
  'Map of the city: click to move the view': 'Carte de la ville : cliquez pour déplacer la vue',
  'Map': 'Carte',
  'Power grid': 'Réseau électrique',
  'Population density': 'Densité de population',
  'Traffic': 'Circulation',
  'Pollution': 'Pollution',
  'Crime': 'Criminalité',
  'Land value': 'Valeur foncière',
  'Police coverage': 'Couverture police',
  'Fire coverage': 'Couverture pompiers',
  'Rate of growth': 'Croissance',
  'legend|Empty': 'Vide',
  'legend|Dense': 'Dense',
  'legend|Light': 'Fluide',
  'legend|Heavy': 'Saturé',
  'legend|Clean': 'Propre',
  'legend|Polluted': 'Pollué',
  'legend|Safe': 'Sûr',
  'legend|Dangerous': 'Dangereux',
  'legend|Low': 'Faible',
  'legend|High': 'Élevée',
  'legend|None': 'Aucune',
  'legend|Full': 'Totale',
  'legend|Declining': 'Déclin',
  'legend|Growing': 'Essor',
  'legend|Unpowered': 'Sans courant',
  'legend|Powered': 'Alimenté',
  'Demand': 'Demande',
  'Demand for residential, commercial and industrial zones': 'Demande en zones résidentielles, commerciales et industrielles',
  'Population {n}': 'Population {n}',
  'Traffic {n}': 'Circulation {n}',
  'Crime {n}': 'Criminalité {n}',
  'Score {n}': 'Score {n}',
  '{years}y {months}m left': 'encore {years} a {months} m',
  '{months}m left': 'encore {months} m',

  // The budget
  'Tax collected': 'Impôts perçus',
  'Cash flow': 'Trésorerie',
  'Previous funds': 'Fonds précédents',
  'Current funds': 'Fonds actuels',
  'Roads': 'Routes',
  'budget|Fire': 'Pompiers',
  'Police': 'Police',
  'Tax': 'Impôts',
  'Reset': 'Rétablir',
  'Cancel': 'Annuler',
  '{percent}% of {total} = {cash}': '{percent} % de {total} = {cash}',
  'Tax rate: {tax}%': 'Taux d\'imposition : {tax} %',

  // The evaluation
  'Public opinion': 'Opinion publique',
  'Is the mayor doing a good job?': 'Le maire fait-il du bon travail ?',
  'Yes:': 'Oui :',
  'No:': 'Non :',
  '{n}%': '{n} %',
  'What are the worst problems?': 'Quels sont les pires problèmes ?',
  'Statistics': 'Statistiques',
  'Net migration': 'Solde migratoire',
  'Assessed value': 'Valeur estimée',
  'Category': 'Catégorie',
  'Game level': 'Niveau de jeu',
  'Annual change': 'Évolution annuelle',
  'Housing': 'Logement',
  'Taxes': 'Impôts',
  'Unemployment': 'Chômage',
  'Fire': 'Incendie',
  'VILLAGE': 'VILLAGE',
  'TOWN': 'BOURG',
  'CITY': 'VILLE',
  'CAPITAL': 'CAPITALE',
  'METROPOLIS': 'MÉTROPOLE',
  'MEGALOPOLIS': 'MÉGALOPOLE',
  'Jan': 'janv.',
  'Feb': 'févr.',
  'Mar': 'mars',
  'Apr': 'avr.',
  'May': 'mai',
  'Jun': 'juin',
  'Jul': 'juil.',
  'Aug': 'août',
  'Sep': 'sept.',
  'Oct': 'oct.',
  'Nov': 'nov.',
  'Dec': 'déc.',

  // The graphs
  'Period': 'Période',
  '10 years': '10 ans',
  '120 years': '120 ans',
  'Year to date': 'Depuis janvier',
  'Since January': 'Depuis le 1er janvier de cette année',
  'Custom': 'Personnalisée',
  'From': 'De',
  'to': 'à',
  'Drag across the graph to look at those years.': 'Faites glisser sur le graphique pour regarder ces années de plus près.',

  // The neighbouring cities
  'Neighbours': 'Voisins',
  'Neighbouring cities': 'Villes voisines',
  'Neighbour deals': 'Accords avec les voisins',
  'Make deals with the cities around yours. Most need a link reaching their edge of the map: build it, and the deal comes into force.':
    'Passez des accords avec les villes autour de la vôtre. La plupart demandent une liaison jusqu\'à leur bord de la carte : construisez-la, et l\'accord entre en vigueur.',
  'North': 'Nord',
  'East': 'Est',
  'South': 'Sud',
  'West': 'Ouest',
  'edge|north': 'nord',
  'edge|east': 'est',
  'edge|south': 'sud',
  'edge|west': 'ouest',
  'Trade agreement': 'Accord commercial',
  'Buy electricity': 'Achat d\'électricité',
  'Sell electricity': 'Vente d\'électricité',
  'Twinning': 'Jumelage',
  'Shops and factories find more customers: more demand for commercial and industrial zones.':
    'Commerces et usines trouvent plus de clients : la demande de zones commerciales et industrielles augmente.',
  'Their power enters your grid by the power line at their edge: as much as a gas power plant gives.':
    'Leur électricité entre dans votre réseau par la ligne électrique à leur bord : autant qu\'une centrale à gaz.',
  'Your spare power goes to them by the power line at their edge: as much as a gas power plant gives.':
    'Votre surplus d\'électricité part chez eux par la ligne électrique à leur bord : autant qu\'une centrale à gaz.',
  'Exchanges between the two cities make yours better known: more people want to move in. No link needed.':
    'Les échanges entre les deux villes font connaître la vôtre : plus de gens veulent s\'y installer. Aucune liaison nécessaire.',
  'Deals are paid with the yearly budget, for the months they were in force. Bigger cities make bigger deals.':
    'Les accords sont réglés avec le budget annuel, pour les mois où ils étaient en vigueur. Plus la ville voisine est grande, plus l\'accord est important.',
  '{n} inhabitants': '{n} habitants',
  'Road or railway': 'Route ou voie ferrée',
  'linked': 'reliée',
  'not linked': 'non reliée',
  '{amount} a year': '{amount} par an',
  'In force': 'En vigueur',
  'On hold: build a road or a railway to this edge.': 'En attente : construisez une route ou une voie ferrée jusqu\'à ce bord.',
  'Needs a road or a railway to this edge.': 'Demande une route ou une voie ferrée jusqu\'à ce bord.',
  'On hold: build a power line to this edge.': 'En attente : construisez une ligne électrique jusqu\'à ce bord.',
  'Needs a power line to this edge.': 'Demande une ligne électrique jusqu\'à ce bord.',
  'Not delivered: the grid does not reach this edge, or has no power to spare.':
    'Non livrée : le réseau n\'atteint pas ce bord, ou n\'a pas d\'électricité en trop.',
  'Deals in force: {amount}.': 'Accords en vigueur : {amount}.',

  // The query window
  'Zone': 'Zone',
  'Density': 'Densité',
  'Value': 'Quartier',
  'Growth': 'Croissance',
  'density|Low': 'Faible',
  'density|Medium': 'Moyenne',
  'density|High': 'Élevée',
  'density|Very High': 'Très élevée',
  'Slum': 'Taudis',
  'Lower Class': 'Populaire',
  'Middle Class': 'Classe moyenne',
  'High': 'Aisé',
  'Safe': 'Nulle',
  'Light': 'Faible',
  'Moderate': 'Modérée',
  'Dangerous': 'Élevée',
  'Heavy': 'Forte',
  'Very Heavy': 'Très forte',
  'Declining': 'En déclin',
  'Stable': 'Stable',
  'Slow Growth': 'Croissance lente',
  'Fast Growth': 'Croissance rapide',
  'Clear': 'Terrain vague',
  'Rubble': 'Décombres',
  'Flood': 'Inondation',
  'Radioactive Waste': 'Déchets radioactifs',
  'Road': 'Route',
  'zone|Power': 'Ligne électrique',
  'Coal Power': 'Centrale à charbon',
  'Fire Department': 'Caserne de pompiers',
  'Police Department': 'Commissariat',
  'Nuclear Power': 'Centrale nucléaire',
  'Draw Bridge': 'Pont-levis',
  'Radar Dish': 'Radar',
  'Fountain': 'Fontaine',
  'Steelers 38  Bears 3': 'Steelers 38  Bears 3',
  'Ur 238': 'Uranium 238',
  'Church': 'Église',
  'Wind Power': 'Éolienne',
  'Gas Power': 'Centrale à gaz',
  'Solar Power': 'Centrale solaire',

  // The other windows
  'Congratulations!': 'Félicitations !',
  '{city} is now a town!': '{city} est maintenant un bourg !',
  '{city} is now a city!': '{city} est maintenant une ville !',
  '{city} is now a capital!': '{city} est maintenant une capitale !',
  '{city} is now a metropolis!': '{city} est maintenant une métropole !',
  '{city} is now a megalopolis!': '{city} est maintenant une mégalopole !',
  'What disaster do you want to befall this unsuspecting world?': 'Quelle catastrophe voulez-vous infliger à ce monde sans méfiance ?',
  'Monster': 'Monstre',
  'disaster|Fire': 'Incendie',
  'disaster|Crash': 'Accident d\'avion',
  'Meltdown': 'Fusion du réacteur',
  'Tornado': 'Tornade',
  'Earthquake': 'Séisme',
  'Unleash': 'Déchaîner',
  'Share a picture': 'Partager une photo',
  'Caption': 'Légende',
  'Name and figures': 'Nom et chiffres',
  'The picture of the city': 'La photo de la ville',
  'To share or copy the picture straight away, the game must be served over HTTPS.':
    'Pour partager ou copier la photo directement, le jeu doit être servi en HTTPS.',
  'Share…': 'Partager…',
  'Copy': 'Copier',
  'Download': 'Télécharger',
  'The picture could not be shared: download it instead.': 'La photo n\'a pas pu être partagée : téléchargez-la plutôt.',
  'Picture copied: paste it into a message or a post.': 'Photo copiée : collez-la dans un message ou une publication.',
  'The picture could not be copied: download it instead.': 'La photo n\'a pas pu être copiée : téléchargez-la plutôt.',
  'Picture saved as {file}.': 'Photo enregistrée sous {file}.',
  'My city, {city}, in KawaCity.': 'Ma ville, {city}, dans KawaCity.',
  'Area to take a picture of': 'Zone à photographier',
  'Visible map': 'Partie visible',
  'Full map': 'Carte entière',
  'Game saved! Choose "Load saved game" on the title screen to carry on later.':
    'Partie sauvée ! Choisissez « Charger la partie sauvée » sur l\'écran titre pour la reprendre plus tard.',
  'Sorry, the game could not be saved in this browser: it may be blocking storage, or it may be full. You can still keep it as a file.':
    'Désolé, la partie n\'a pas pu être sauvée dans ce navigateur : il bloque peut-être le stockage, ou celui-ci est plein. Vous pouvez quand même la garder dans un fichier.',
  'saveFile': 'Ou <a id="saveDownload" href="#" download="city.kawacity">gardez-en une copie dans un fichier</a>, à ouvrir depuis l\'écran titre.',
  'nag': 'Ouah ! Vous jouez à ce truc depuis une demi-heure ?!? Si ça vous plaît, Graeme McCutcheon, l\'auteur de micropolisJS sur lequel KawaCity est basé, serait ravi que votre argent aille à <a class="nag" href="https://www.refuweegee.co.uk/your-donations" target="_blank" rel="noopener">Refuweegee</a>, une association qui aide les réfugiés en Écosse.',
  'Automatic budget': 'Budget automatique',
  'On': 'Oui',
  'Off': 'Non',
  'Automatic bulldozing': 'Bulldozer automatique',
  'Speed': 'Vitesse',
  'Random disasters': 'Catastrophes aléatoires',
  'Day and night': 'Jour et nuit',
  'Language': 'Langue',
  'Add funds': 'Ajouter des fonds',
  'Yes': 'Oui',
  'No': 'Non',

  // The simulation's messages
  'Fire departments need funding': 'Les pompiers manquent de crédits',
  'Commerce requires an Airport': 'Le commerce réclame un aéroport',
  'Citizens demand a Fire Department': 'Les habitants réclament une caserne de pompiers',
  'Build a Power Plant': 'Construisez une centrale électrique',
  'More industrial zones needed': 'Il faut plus de zones industrielles',
  'More commercial zones needed': 'Il faut plus de zones commerciales',
  'More residential zones needed': 'Il faut plus de zones résidentielles',
  'Inadequate rail system': 'Réseau ferré insuffisant',
  'More roads required': 'Il faut plus de routes',
  'Citizens demand a Police Department': 'Les habitants réclament un commissariat',
  'Industry requires a Sea Port': 'L\'industrie réclame un port',
  'Residents demand a Stadium': 'Les habitants réclament un stade',
  'Roads deteriorating, due to lack of funds': 'Les routes se dégradent faute de crédits',
  'Police departments need funding': 'La police manque de crédits',
  'Welcome to KawaCity': 'Bienvenue dans KawaCity',
  'Brownouts, build another Power Plant': 'Baisses de tension : construisez une autre centrale',
  'Major earthquake reported !!': 'Violent séisme signalé !!',
  'Explosion detected': 'Explosion détectée',
  'Firebombing reported!': 'Bombardements incendiaires signalés !',
  'Flooding reported !': 'Inondation signalée !',
  'Fire reported': 'Incendie signalé',
  'Heavy Traffic reported': 'Circulation dense signalée',
  'A helicopter crashed': 'Un hélicoptère s\'est écrasé',
  'Crime very high': 'Criminalité très élevée',
  'Pollution very high': 'Pollution très élevée',
  'A Monster has been sighted !': 'Un monstre a été aperçu !',
  'YOUR CITY HAS GONE BROKE': 'VOTRE VILLE EST EN FAILLITE',
  'Blackouts reported: insufficient power capacity': 'Coupures de courant : production électrique insuffisante',
  'A Nuclear Meltdown has occurred !!': 'Le cœur d\'un réacteur nucléaire a fondu !!',
  'A plane has crashed': 'Un avion s\'est écrasé',
  'Shipwreck reported': 'Naufrage signalé',
  'Citizens upset. The tax rate is too high': 'Habitants mécontents : les impôts sont trop élevés',
  'Tornado reported !': 'Tornade signalée !',
  'Frequent traffic jams reported': 'Embouteillages fréquents signalés',
  'A train crashed': 'Un train a déraillé',
  'Population has reached 2,000': 'La population a atteint 2 000 habitants',
  'Population has reached 10,000': 'La population a atteint 10 000 habitants',
  'Population has reached 50,000': 'La population a atteint 50 000 habitants',
  'Population has reached 100,000': 'La population a atteint 100 000 habitants',
  'Population has reached 500,000': 'La population a atteint 500 000 habitants',

  // The scenarios
  'Dullsville, USA': 'Dullsville, États-Unis',
  'San Francisco, CA': 'San Francisco, Californie',
  'Hamburg, Germany': 'Hambourg, Allemagne',
  'Bern, Switzerland': 'Berne, Suisse',
  'Tokyo, Japan': 'Tokyo, Japon',
  'Detroit, MI': 'Detroit, Michigan',
  'Boston, MA': 'Boston, Massachusetts',
  'Rio de Janeiro, Brazil': 'Rio de Janeiro, Brésil',
  'Things haven\'t changed much around here in the last hundred years or so and the residents are beginning to get bored. They think Dullsville could be the next great city with the right leader.':
    'Rien n\'a vraiment changé ici depuis une centaine d\'années, et les habitants commencent à s\'ennuyer. Ils pensent que Dullsville pourrait devenir une grande ville, avec le bon dirigeant.',
  'It is your job to attract new growth and development, turning Dullsville into a Metropolis within 30 years.':
    'À vous d\'attirer la croissance et le développement, pour faire de Dullsville une métropole en 30 ans.',
  'Damage from the earthquake was minor compared to that of the ensuing fires, which took days to control. 1500 people died.':
    'Les dégâts du séisme furent peu de chose à côté de ceux des incendies qui suivirent, et qu\'il fallut des jours pour maîtriser. 1500 personnes périrent.',
  'Controlling the fires should be your initial concern. Then clear the rubble and start rebuilding. You have 5 years.':
    'Maîtriser les incendies doit être votre premier souci. Dégagez ensuite les décombres et commencez à reconstruire. Vous avez 5 ans.',
  'Allied fire-bombing of German cities in WWII caused tremendous damage and loss of life. People living in the inner cities were at greatest risk.':
    'Les bombardements incendiaires alliés sur les villes allemandes, pendant la Seconde Guerre mondiale, firent d\'immenses dégâts et de très nombreuses victimes. Les habitants des centres-villes étaient les plus exposés.',
  'You must control the firestorms during the bombing and then rebuild the city after the war. You have 5 years.':
    'Vous devez maîtriser les tempêtes de feu pendant les bombardements, puis reconstruire la ville après la guerre. Vous avez 5 ans.',
  'The roads here are becoming more congested every day, and the residents are upset. They demand that you do something about it.':
    'Les routes d\'ici sont chaque jour plus encombrées, et les habitants sont mécontents. Ils exigent que vous agissiez.',
  'Some have suggested a mass transit system as the answer, but this would require major rezoning in the downtown area. You have 10 years.':
    'Certains proposent un réseau de transports en commun, mais il faudrait pour cela redessiner une bonne partie du centre-ville. Vous avez 10 ans.',
  'A large reptilian creature has been spotted heading for Tokyo bay. It seems to be attracted to the heavy levels of industrial pollution there.':
    'Une énorme créature reptilienne a été repérée, en route vers la baie de Tokyo. Elle semble attirée par la forte pollution industrielle qui y règne.',
  'Try to control the fires, then rebuild the industrial center. You have 5 years.':
    'Tâchez de maîtriser les incendies, puis reconstruisez le centre industriel. Vous avez 5 ans.',
  'By 1970, competition from overseas and other economic factors pushed the once "automobile capital of the world" into recession. Plummeting land values and unemployment then increased crime in the inner-city to chronic levels.':
    'Vers 1970, la concurrence étrangère et d\'autres facteurs économiques plongèrent l\'ancienne « capitale mondiale de l\'automobile » dans la récession. L\'effondrement des prix fonciers et le chômage firent alors grimper la criminalité du centre-ville à des niveaux chroniques.',
  'You have 10 years to reduce crime and rebuild the industrial base of the city.':
    'Vous avez 10 ans pour faire baisser la criminalité et reconstruire la base industrielle de la ville.',
  'A major meltdown is about to occur at one of the new downtown nuclear reactors. The area in the vicinity of the reactor will be severely contaminated by radiation, forcing you to restructure the city around it.':
    'Le cœur d\'un des nouveaux réacteurs nucléaires du centre-ville est sur le point de fondre. Les environs du réacteur seront gravement contaminés par la radioactivité, et vous devrez réorganiser la ville autour.',
  'You have 5 years to get the situation under control.': 'Vous avez 5 ans pour reprendre la situation en main.',
  'In the mid-21st century, the greenhouse effect raised global temperatures 6 degrees F. Polar icecaps melted and raised sea levels worldwide. Coastal areas were devastated by flood and erosion.':
    'Au milieu du XXIe siècle, l\'effet de serre fit monter les températures de 3 degrés. Les calottes polaires fondirent, et le niveau des mers monta partout. Les côtes furent dévastées par les inondations et l\'érosion.',
  'You have 10 years to turn this swamp back into a city again.': 'Vous avez 10 ans pour refaire de ce marécage une ville.',
  'Be a Metropolis (over 100,000 people)': 'devenir une métropole (plus de 100 000 habitants)',
  'Bring the average traffic below 80': 'faire passer la circulation moyenne sous 80',
  'Bring the average crime below 60': 'faire passer la criminalité moyenne sous 60',
  'Raise the city score above 500': 'faire monter le score de la ville au-dessus de 500',
  'Goal: {goal} within {years} years.': 'Objectif : {goal}, en {years} ans.',
  'Goal reached: {goal}.': 'Objectif atteint : {goal}.',
  'Goal missed: {goal}.': 'Objectif manqué : {goal}.',
  'Title screen': 'Écran titre',
  'Try again': 'Réessayer',
  'Take office': 'Prendre ses fonctions',
  'Keep playing': 'Continuer',
  'You\'re a winner!': 'Victoire !',
  'Impeachment notice!': 'Avis de destitution !',
  'Your mayorial skill and city planning expertise have earned you the KEY TO THE CITY. Local residents will erect monuments to your glory and name their first-born children after you. Why not run for governor?':
    'Vos talents de maire et d\'urbaniste vous ont valu les CLÉS DE LA VILLE. Les habitants élèveront des monuments à votre gloire et donneront votre nom à leurs premiers-nés. Pourquoi ne pas briguer le poste de gouverneur ?',
  'The entire population of this city has finally had enough of your inept planning and incompetent management. An angry mob -- led by your mother -- has been spotted in the vicinity of city hall.':
    'La population tout entière en a enfin assez de votre urbanisme inepte et de votre gestion incompétente. Une foule en colère, menée par votre propre mère, a été aperçue aux abords de l\'hôtel de ville.',
  'You should seriously consider taking an extended vacation -- NOW. (Or try again.)':
    'Vous devriez sérieusement envisager de longues vacances, et TOUT DE SUITE. (Ou de réessayer.)',

  // The news ticker
  'CITY': 'VILLE',
  'ADVISOR': 'CONSEIL',
  'WARNING': 'ATTENTION',
  'ALERT': 'ALERTE',
  'BREAKING': 'FLASH',
  'GOOD NEWS': 'BONNE NOUVELLE',
  'GOSSIP': 'POTINS',
  'RUMOUR': 'RUMEUR',
  'OPINION': 'TRIBUNE',
  'SATIRE': 'SATIRE',
  'Major earthquake in {city}! Put out the fires, then rebuild.': 'Violent séisme à {city} ! Éteignez les incendies, puis reconstruisez.',
  'Explosion reported! Fires may break out around it.': 'Explosion signalée ! Des incendies peuvent se déclarer autour.',
  'Fire reported! Fire stations nearby put fires out faster.': 'Incendie signalé ! Les casernes proches éteignent les feux plus vite.',
  'Firebombing reported! Fires are breaking out across {city}.': 'Bombardements incendiaires ! Des incendies éclatent partout à {city}.',
  'Flooding reported! The water will recede in time.': 'Inondation signalée ! L\'eau finira par se retirer.',
  'A monster has been sighted in {city}!': 'Un monstre a été aperçu à {city} !',
  'Nuclear meltdown! The area will stay radioactive for a very long time.': 'Fusion nucléaire ! La zone restera radioactive très longtemps.',
  'Tornado reported! Rebuild what it flattens once it has passed.': 'Tornade signalée ! Reconstruisez ce qu\'elle rase une fois qu\'elle sera passée.',
  'A helicopter has crashed!': 'Un hélicoptère s\'est écrasé !',
  'A plane has crashed!': 'Un avion s\'est écrasé !',
  'Shipwreck reported!': 'Naufrage signalé !',
  'A train has crashed!': 'Un train a déraillé !',
  'Blackouts reported: {city} needs more power plants.': 'Coupures de courant : {city} a besoin de plus de centrales.',
  'Brownouts reported: build another power plant.': 'Baisses de tension : construisez une autre centrale.',
  '{city} has gone broke! Raise taxes, or cut spending in the Budget window.':
    '{city} est en faillite ! Augmentez les impôts, ou réduisez les dépenses dans la fenêtre Budget.',
  '{city} is now a town: the population passes 2,000!': '{city} est maintenant un bourg : la population dépasse 2 000 habitants !',
  '{city} is now a city: the population passes 10,000!': '{city} est maintenant une ville : la population dépasse 10 000 habitants !',
  '{city} is now a capital: the population passes 50,000!': '{city} est maintenant une capitale : la population dépasse 50 000 habitants !',
  '{city} is now a metropolis: the population passes 100,000!': '{city} est maintenant une métropole : la population dépasse 100 000 habitants !',
  '{city} is now a megalopolis: the population passes 500,000!': '{city} est maintenant une mégalopole : la population dépasse 500 000 habitants !',
  'class|village': 'village',
  'class|town': 'bourg',
  'class|city': 'ville',
  'class|capital': 'capitale',
  'class|metropolis': 'métropole',
  'class|megalopolis': 'mégalopole',
  'crime': 'la criminalité',
  'pollution': 'la pollution',
  'housing costs': 'le prix du logement',
  'taxes': 'les impôts',
  'traffic': 'la circulation',
  'unemployment': 'le chômage',
  'fires': 'les incendies',
  'build police stations where it is worst, and fund them fully':
    'construisez des commissariats là où c\'est le pire, et financez-les entièrement',
  'keep industry away from homes, plant parks and choose clean power':
    'éloignez l\'industrie des logements, plantez des parcs et choisissez une énergie propre',
  'zone more homes, away from the expensive centre': 'créez plus de logements, loin du centre où tout est cher',
  'lower the tax rate in the Budget window': 'baissez les impôts dans la fenêtre Budget',
  'add rail, avenues or highways where the roads jam': 'ajoutez rail, avenues ou autoroutes là où ça bouchonne',
  'zone more commercial and industrial land': 'créez plus de zones commerciales et industrielles',
  'build fire stations, and fund them fully': 'construisez des casernes, et financez-les entièrement',
  'A monster is rampaging through {city}! It will leave in time: rebuild behind it.':
    'Un monstre saccage {city} ! Il finira par partir : reconstruisez derrière lui.',
  'A tornado is tearing across {city}! Rebuild once it has blown over.': 'Une tornade balaie {city} ! Reconstruisez une fois qu\'elle sera passée.',
  'Flood water covers part of {city}. It will recede on its own.': 'L\'eau recouvre une partie de {city}. Elle se retirera d\'elle-même.',
  'A fire is burning! Fire stations nearby put it out faster.': 'Un incendie fait rage ! Les casernes proches l\'éteignent plus vite.',
  'Fire is spreading over {n} tiles! Fire stations nearby put it out faster.':
    'Le feu s\'étend sur {n} cases ! Les casernes proches l\'éteignent plus vite.',
  '{city} is broke ({funds})! Raise taxes or cut services in the Budget window.':
    '{city} est à sec ({funds}) ! Augmentez les impôts ou réduisez les services dans la fenêtre Budget.',
  'Only {funds} left in the treasury: spend wisely, or raise taxes.': 'Plus que {funds} en caisse : dépensez avec sagesse, ou augmentez les impôts.',
  'Upkeep costs {deficit} a year more than taxes bring in: raise taxes or trim services.':
    'L\'entretien coûte {deficit} de plus par an que ce que rapportent les impôts : augmentez-les ou réduisez les services.',
  'Welcome to {city}! Build a power plant, zone homes, shops and factories, and link them with roads and power lines.':
    'Bienvenue à {city} ! Construisez une centrale, créez des zones d\'habitations, de commerces et d\'usines, et reliez-les par des routes et des lignes électriques.',
  'No power plant in {city}: zones won\'t grow without electricity.': 'Aucune centrale à {city} : sans électricité, les zones ne se développeront pas.',
  'A zone has no power: build another plant, or connect it with power lines.':
    'Une zone n\'a pas de courant : construisez une autre centrale, ou reliez-la par des lignes électriques.',
  '{n} zones without power: build another plant, or connect them with power lines.':
    '{n} zones sans courant : construisez une autre centrale, ou reliez-les par des lignes électriques.',
  'Residents demand a stadium: homes won\'t grow any further without one.':
    'Les habitants réclament un stade : sans lui, les logements ne se développeront plus.',
  'Commerce needs an airport to grow any further.': 'Le commerce a besoin d\'un aéroport pour continuer à grandir.',
  'Industry needs a seaport to grow any further.': 'L\'industrie a besoin d\'un port pour continuer à grandir.',
  'The trade agreement with {name} is on hold: build a road or a railway to the {side} edge of the map.':
    'L\'accord commercial avec {name} est en attente : construisez une route ou une voie ferrée jusqu\'au bord {side} de la carte.',
  'The electricity bought from {name} is on hold: build a power line to the {side} edge of the map.':
    'L\'achat d\'électricité à {name} est en attente : construisez une ligne électrique jusqu\'au bord {side} de la carte.',
  'The electricity sold to {name} is on hold: build a power line to the {side} edge of the map.':
    'La vente d\'électricité à {name} est en attente : construisez une ligne électrique jusqu\'au bord {side} de la carte.',
  '{name} gets none of the electricity it buys: link the power line at the {side} edge to the grid, or build another power plant.':
    '{name} ne reçoit pas l\'électricité achetée : reliez au réseau la ligne électrique du bord {side}, ou construisez une autre centrale.',
  'Citizens demand a police station: crime grows unchecked without one.':
    'Les habitants réclament un commissariat : sans lui, la criminalité prospère.',
  'Citizens demand a fire station: nothing would stop a fire today.':
    'Les habitants réclament une caserne : aujourd\'hui, rien n\'arrêterait un incendie.',
  'Police stations are funded at {percent}%: crime will rise.': 'Les commissariats sont financés à {percent} % : la criminalité va grimper.',
  'Fire stations are funded at {percent}%: fires will spread further.':
    'Les casernes sont financées à {percent} % : les incendies s\'étendront davantage.',
  'Roads are funded at {percent}%: they are falling apart.': 'Les routes sont financées à {percent} % : elles tombent en ruine.',
  'Taxes at {tax}% are driving people away from {city}.': 'Des impôts à {tax} % font fuir les habitants de {city}.',
  'Pollution is very high: keep industry away from homes, plant parks and choose clean power.':
    'La pollution est très élevée : éloignez l\'industrie des logements, plantez des parcs et choisissez une énergie propre.',
  'Crime is very high: build police stations where it is worst.': 'La criminalité est très élevée : construisez des commissariats là où c\'est le pire.',
  'Traffic jams all over {city}: add rail, avenues or highways.': 'Bouchons partout à {city} : ajoutez rail, avenues ou autoroutes.',
  'Only {yes}% of citizens approve of the Mayor: time to listen to their worries.':
    'Seulement {yes} % des habitants approuvent le maire : il est temps d\'écouter leurs soucis.',
  '{city} lost a resident last year.': '{city} a perdu un habitant l\'an dernier.',
  '{city} lost {n} residents last year.': '{city} a perdu {n} habitants l\'an dernier.',
  'People are queueing to move to {city}: zone more homes.': 'On fait la queue pour s\'installer à {city} : créez plus de logements.',
  'Too many empty homes: hold off on residential zones.': 'Trop de logements vides : levez le pied sur les zones résidentielles.',
  'Shops are in demand: zone more commercial land.': 'Les commerces sont demandés : créez plus de zones commerciales.',
  'Too many empty shops: hold off on commercial zones.': 'Trop de commerces vides : levez le pied sur les zones commerciales.',
  'Industry wants to settle here: zone more industrial land.': 'L\'industrie veut s\'installer ici : créez plus de zones industrielles.',
  'Too many empty factories: hold off on industrial zones.': 'Trop d\'usines vides : levez le pied sur les zones industrielles.',
  'Citizens\' biggest worry: {problem} ({votes}% of voters). To fix it, {advice}.':
    'Premier souci des habitants : {problem} ({votes} % des électeurs). Pour y remédier, {advice}.',
  'Also worrying citizens: {problem} ({votes}% of voters). To fix it, {advice}.':
    'Autre souci des habitants : {problem} ({votes} % des électeurs). Pour y remédier, {advice}.',
  '{city}, {class}: population {pop}, approval {yes}%, score {score}.':
    '{city}, {class} : {pop} habitants, {yes} % d\'opinions favorables, score {score}.',
  '{city} welcomed a new resident last year.': '{city} a accueilli un nouvel habitant l\'an dernier.',
  '{city} welcomed {n} new residents last year.': '{city} a accueilli {n} nouveaux habitants l\'an dernier.',
  'Treasury: {funds}, with taxes at {tax}%.': 'Trésorerie : {funds}, avec des impôts à {tax} %.',
  'All quiet in {city}: no disaster, no crisis. Enjoy it while it lasts.':
    'Tout est calme à {city} : ni catastrophe, ni crise. Profitez-en tant que ça dure.'
};


var jokes = {
  road: [
    'Le maire ouvre une nouvelle rue : « C\'est la voie de la réélection. »',
    '{n} cases de route et ça continue : le maire a décidément le bitume dans le sang.',
    'L\'opposition accuse le maire de tourner en rond. Réponse de la mairie : c\'est un rond-point.',
    'Nouvelle rue inaugurée : selon le maire, il n\'y a pas de sens interdit au progrès.'
  ],
  dirtroad: [
    'Chemins de terre approuvés : le maire veut une ville qui garde les pieds sur terre.',
    'Nouveau chemin de terre : les laveurs de voitures remercient personnellement le maire.',
    'Le maire défend ses chemins de terre : « Ce n\'est pas de la boue, c\'est du terroir. »'
  ],
  avenue: [
    'Le maire inaugure une avenue : « L\'avenir appartient à ceux qui élargissent les rues. »',
    'Nouvelle avenue : deux fois plus de voies, deux fois plus d\'entretien, deux fois plus de fierté pour le maire.'
  ],
  highway: [
    'Nouvelle autoroute : les habitants pourront désormais être coincés dans les bouchons deux fois plus vite.',
    'Le maire inaugure l\'autoroute et file à l\'anglaise. À 130 km/h.',
    'Autoroute ouverte : le maire assure que la ville est sur la bonne voie. Sur trois voies, même.'
  ],
  rail: [
    'Le maire pose encore des rails. L\'opposition craint un déraillement du budget.',
    'Les amateurs de trains sont ravis : « Ce maire est enfin sur les bons rails. »',
    'Nouvelle ligne de train : le maire promet que le projet ne restera pas à quai.'
  ],
  wire: [
    'Le maire tire encore des lignes électriques. Les habitants trouvent ça choquant.',
    'Des câbles partout : la mairie parle d\'un nouveau courant de pensée.',
    'Le maire branche toute la ville. L\'opposition dénonce un projet sous haute tension.'
  ],
  coal: [
    'Nouvelle centrale à charbon : le maire promet un avenir radieux, quoiqu\'un peu enfumé.',
    'Le maire défend sa centrale à charbon : « Ce n\'est pas du smog, c\'est de l\'ambiance. »',
    'Centrale à charbon inaugurée : le linge étendu dehors revient désormais gris anthracite.'
  ],
  nuclear: [
    'Centrale nucléaire approuvée : le maire juge le projet rayonnant.',
    'Interrogé sur la sécurité du réacteur, le maire a donné une réponse à demi-vie.',
    'Le maire visite la centrale nucléaire et en ressort, selon ses proches, irradiant de bonheur.'
  ],
  gas: [
    'Centrale à gaz inaugurée : le maire met les gaz sur la transition énergétique.',
    'Le maire présente sa centrale à gaz : « De l\'eau dans le gaz ? Absolument pas. »'
  ],
  solar: [
    'Centrale solaire inaugurée : les idées du maire voient enfin le jour.',
    'Le maire vante l\'énergie solaire : « Une idée lumineuse. Les jours de beau temps. »'
  ],
  wind: [
    'Éolienne inaugurée. L\'opposition rappelle que les discours du maire produisent déjà beaucoup de vent.',
    'Le maire mise sur l\'éolien : « Le vent tourne en notre faveur. »',
    'Le maire inaugure une éolienne et brasse beaucoup d\'air, comme d\'habitude.'
  ],
  residential: [
    'Le maire crée des logements : « On n\'est jamais si bien que chez soi, alors construisons-en plein. »',
    'Nouvelles zones résidentielles : les promoteurs saluent un maire qui a du terrain à revendre.',
    '{n} zones résidentielles : le maire commence à manquer de noms de rues.',
    'Plan logement du maire : « Construisez-les et ils viendront. Puis ils se plaindront du stationnement. »'
  ],
  commercial: [
    'Le maire crée des zones commerciales : selon les économistes, {city} a du potentiel en magasin.',
    'Nouveau quartier commerçant : le maire parle de thérapie par le shopping pour toute la ville.',
    'Les zones commerciales du maire seraient une affaire, disent les experts. Prix susceptibles de varier.'
  ],
  industrial: [
    'Nouvelles usines : le maire promet des emplois, de la fumée, et encore des emplois.',
    'Zone industrielle approuvée : les ouvriers saluent un maire qui sait faire tourner la boutique.',
    'Le maire visite la zone industrielle et en ressort couvert de suie et d\'enthousiasme.'
  ],
  police: [
    'Nouveau commissariat : la criminalité aurait été arrêtée net.',
    'Le maire inaugure un commissariat : les malfrats de {city} sont priés de se tenir à carreau.',
    'Le commissaire remercie le maire : « Nous aurons l\'œil sur tout. Y compris sur vous. »'
  ],
  fire: [
    'Nouvelle caserne : le maire fait de la sécurité une question brûlante.',
    'Le maire glisse le long de la barre de la nouvelle caserne. Inauguration reportée, direction les urgences.',
    'Les pompiers remercient le maire : « Votre soutien nous a vraiment enflammés. »'
  ],
  school: [
    'Nouvelle école : le maire a enfin de la classe.',
    'Le maire visite la nouvelle école et rate une interro surprise sur le zonage.'
  ],
  university: [
    'Université fondée : le maire reçoit un doctorat honoris causa en Clics de Souris.',
    'Nouvelle université : les étudiants manifestent aussitôt contre le maire. La tradition est respectée.'
  ],
  park: [
    'Encore un parc : le maire se met au vert.',
    '{n} parcs déjà : les écureuils soutiennent le maire pour un second mandat.',
    'Le maire ouvre un parc : « Le vert, c\'est le nouveau gris. »'
  ],
  garden: [
    'Le maire plante un jardin. Ses détracteurs l\'accusent de marcher sur leurs plates-bandes.',
    'Nouveaux massifs de fleurs : la cote du maire est en pleine floraison.'
  ],
  plaza: [
    'Nouvelle place : le maire promet que chacun y trouvera sa place.',
    'Le maire inaugure une place avec fontaine. Les pigeons organisent une fête.'
  ],
  bigpark: [
    'Grand parc inauguré : pour le maire, ce fut une promenade de santé.',
    'Le nouveau parc du maire a un étang. Les canards promettent leur vote.'
  ],
  stadium: [
    'Nouveau stade : le maire donne le coup d\'envoi et rate le ballon.',
    'Stade inauguré : les supporters scandent le nom du maire, presque sans faute.'
  ],
  port: [
    'Nouveau port : les projets du maire sont enfin à flot.',
    'Le maire inaugure le port et promet de garder le cap. Les marins demandent lequel.'
  ],
  airport: [
    'Aéroport inauguré : les ambitions du maire décollent.',
    'Le maire coupe le ruban du nouvel aéroport. Le ruban attend toujours ses bagages.'
  ],
  trees: [
    'Le maire plante des arbres : une politique qui prend racine.',
    'Nouvelle forêt : le maire est désormais officiellement enraciné dans la commune.',
    'Le maire a planté {n} arbres. Les bûcherons demandent un rendez-vous.'
  ],
  water: [
    'Le maire creuse un lac : la mairie parle d\'un projet profond.',
    'L\'opposition dit que le canal du maire prend l\'eau. C\'est un peu le principe.'
  ],
  landfill: [
    'Remblai approuvé : le maire comble enfin ses lacunes.',
    'Le maire comble l\'eau pour bâtir. Les poissons portent plainte.'
  ],
  bulldozer: [
    'Le maire rase un autre pâté de maisons : « Démolir, c\'est construire à l\'envers. »',
    'Le bulldozer du maire aperçu à nouveau. Ses proches décrivent un tempérament de boule de démolition.',
    '{n} cases rasées : les entrepreneurs saluent un maire qui fait table rase.',
    'Le maire dégage du terrain « pour faire place à l\'avenir ». L\'avenir n\'a pas commenté.'
  ],
  query: [
    'Le maire inspecte encore les bâtiments. « Simple curiosité », dit la mairie.',
    'Le maire pose tant de questions que l\'Insee envisage de l\'embaucher.',
    'Des habitants surprennent le maire à regarder par leurs fenêtres « à des fins statistiques ».'
  ],
  noMoney: [
    'Le maire a voulu construire sans argent. La banque a répondu : « Bien essayé. »',
    'Caisses vides : le maire fouille sous les coussins du canapé de la mairie.',
    'Le maire propose de payer les entreprises en compliments. Les entreprises déclinent.'
  ],
  needsBulldoze: [
    'Le maire tente de construire sur un bâtiment. Les architectes : « Ce n\'est pas comme ça que marchent les étages. »',
    'Le maire a voulu caser deux bâtiments au même endroit. La physique gagne encore.'
  ],
  taxUp: [
    'Impôts à {tax} % : le maire parle d\'une « contribution volontaire, mais obligatoire ».',
    'Hausse d\'impôts : les habitants sont taxés, le maire est relaxé.',
    'Le maire monte les impôts à {tax} % : « Voyez ça comme un abonnement à {city}. »'
  ],
  taxDown: [
    'Impôts baissés à {tax} % : la cote du maire monte, la trésorerie descend.',
    'Le maire baisse les impôts. Les portefeuilles applaudissent, les comptables pleurent.'
  ],
  policeCut: [
    'Budget de la police réduit : les malfrats envoient une carte de remerciement au maire.',
    'Moins de crédits pour la police : les agents devront poursuivre les suspects au pas.'
  ],
  fireCut: [
    'Budget des pompiers réduit : ils devront souffler très fort sur les incendies.',
    'Moins de crédits pour les pompiers : le maire suggère des seaux « pour les petits feux ».'
  ],
  roadCut: [
    'Budget des routes réduit : le maire qualifie les nids-de-poule de « ralentisseurs naturels ».',
    'Travaux reportés : le maire promet que les nids-de-poule forgeront le caractère.'
  ],
  'disaster:Monster': [
    'Le maire nie avoir invité le monstre : « On voulait juste plus de touristes. »',
    'Le monstre était un test de résistance, selon la mairie. La ville a résisté, les bâtiments moins.'
  ],
  'disaster:Fire': [
    'Les pompiers prient le maire d\'arrêter de « les tester ».',
    'Le maire allume un incendie « pour vérifier les détecteurs de fumée ». Ils marchent.'
  ],
  'disaster:Flood': [
    'Pour le maire, l\'inondation est une piscine municipale gratuite.',
    'Le maire commande une inondation. Les ventes de parapluies explosent, celles de bateaux aussi.'
  ],
  'disaster:Crash': [
    'La tour de contrôle demande au maire d\'arrêter d\'appuyer sur le gros bouton rouge.',
    'Crash commandé par la mairie : la compagnie aérienne revoit ses destinations.'
  ],
  'disaster:Meltdown': [
    'Le maire provoque une fusion du réacteur. Les habitants rayonnent désormais de fierté civique.',
    'Fusion nucléaire volontaire : le maire parle d\'une décision énergique.'
  ],
  'disaster:Tornado': [
    'Le maire déclenche une tornade : la mairie évoque un mandat tourbillonnant.',
    'Tornade commandée par la mairie : le maire voulait faire le ménage dans l\'opposition.'
  ],
  'disaster:Earthquake': [
    'Séisme ! Selon le maire, il s\'agissait juste de secouer un peu la ville.',
    'Le maire commande un tremblement de terre. Les sismologues notent la décision 8,5 sur l\'échelle de Richter.'
  ],
  disastersOff: [
    'Le maire interdit les catastrophes par arrêté. Le syndicat des monstres est furieux.',
    'Catastrophes interdites à {city} : les tornades devront désormais demander un permis.'
  ],
  nightOff: [
    'Le maire abolit la nuit. Les hiboux manifestent devant la mairie.'
  ],
  harder: [
    'Le maire se complique la vie exprès. « Ça forge le caractère », dit la mairie.'
  ],
  easier: [
    'Le maire baisse la difficulté. Personne ne juge. Enfin, un peu.'
  ],
  pause: [
    'Le maire a encore arrêté le temps. Le syndicat des horlogers porte plainte.',
    'Temps suspendu par la mairie : des habitants figés en plein éternuement demandent des comptes.'
  ],
  fast: [
    'Le maire met le temps en avance rapide. Les habitants se plaignent de vieillir à vue d\'œil.',
    'Temps accéléré sur ordre du maire : les ventes de gâteaux d\'anniversaire triplent.'
  ],
  slow: [
    'Le maire ralentit le temps : « Rien ne sert de courir, il faut zoner à point. »'
  ],
  save: [
    'Le maire sauve la ville. Pas d\'une catastrophe : sur le disque.',
    'Ville sauvegardée : le maire peut désormais faire des erreurs en toute confiance.'
  ],
  picture: [
    'Le maire prend encore une photo de la ville. Les ventes de cartes postales s\'envolent.',
    'La dernière photo de la ville par le maire fait le buzz. Enfin, sa famille a aimé.'
  ],
  deal: [
    'Le maire signe un accord avec une ville voisine. Chaque camp jure avoir roulé l\'autre.',
    'Nouveau partenariat avec les voisins : la poignée de main du maire aurait duré onze minutes.',
    'Diplomatie à la mairie : échange de cadeaux avec le maire d\'à côté. Le nôtre a reçu un porte-clés.',
    'Déjà {n} accords avec les voisins. Le maire se verrait bien ministre des Affaires étrangères.'
  ],
  dealEnded: [
    'Le maire déchire un accord avec les voisins. Les voisins gardent le porte-clés.',
    'Fin d\'un partenariat. Le maire aux voisins : « Ce n\'est pas vous, c\'est nous. »'
  ],
  idle: [
    'Le maire n\'a pas été vu depuis un moment. La mairie parle d\'« observation stratégique ».',
    'Journée calme à la mairie : le maire regarderait passer les voitures, pour le plaisir.',
    'Le maire fixe la carte depuis des minutes. Les experts parlent de vision à long terme.'
  ],
  generic: [
    'Sondage : {yes} % des habitants approuvent le maire. Les {no} % restants l\'ont rencontré.',
    'Nouveau slogan du maire : « Zoner, c\'est gagner. »',
    'La machine à café de la mairie est en panne : le maire décrète l\'état d\'urgence.',
    'Un pigeon se présente au conseil municipal. Le maire salue la concurrence.',
    'Le maire promet d\'en finir avec les bouchons. Les bouchons rigolent.',
    'Fuite : la liste de tâches du maire. 1. Bâtir la ville. 2. ??? 3. Réélection.',
    'Météo à {city} : ensoleillé, avec un risque de zonage.',
    'Sondage : 9 habitants sur 10 ne connaissent pas le nom du maire. Le dixième, c\'est le maire.',
    'La mairie annonce un plan pour planifier davantage de plans.',
    'Un chat nommé adjoint d\'honneur : la popularité de la mairie s\'envole.',
    'Le maire dément les rumeurs de monorail secret. Pour l\'instant.',
    'La pause déjeuner du maire entame sa troisième heure. La mairie parle de déjeuner de travail.',
    '{funds} en caisse : le maire voudrait tout dépenser en fontaines.',
    'Population : {pop}. Le maire en a personnellement rencontré au moins six.'
  ]
};


var French = {strings: strings, jokes: jokes};


export { French };
