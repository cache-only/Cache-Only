// Two languages: English and Catalan. The choice is saved as gh:app:lang.
import { createStore } from './storage.js';

const store = createStore('app');
export const LANGS = ['en', 'ca'];

const STRINGS = {
  en: {
    'common.back': 'Back to games',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.share': 'Share',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.undo': 'Undo',
    'common.redo': 'Redo',
    'common.newGame': 'New game',

    'launcher.games': 'Games',
    'launcher.play': 'Play',
    'launcher.resume': 'Resume',
    'launcher.score': 'Score {score}',
    'launcher.mission': 'Mission {n}',
    'launcher.download': 'Download',
    'launcher.downloadGame': 'Download {name}, {size}',
    'launcher.downloadAll': 'Download all · {size}',
    'launcher.downloadingAll': 'Downloading {done} of {total}…',
    'launcher.downloading': 'Downloading…',
    'launcher.queued': 'Queued',
    'launcher.downloadFailed': 'Download failed. Tap to retry.',
    'launcher.needsHost': 'Go online to download',
    'launcher.settings': 'Settings',
    'launcher.language': 'Language',

    'status.checking': 'Checking offline files…',
    'status.preparing': 'Preparing the app… {done}/{total}',
    'status.downloadingHint': 'Keep the app open and stay online.',
    'status.ready': 'Ready offline',
    'status.hostOnline': 'Online. Download the games you want to keep.',
    'status.hostOffline': 'Offline. Downloaded games still work.',
    'status.allReady': 'Every game is downloaded. Safe to switch on airplane mode.',
    'status.failed': 'Download failed',
    'status.failedHint': 'Check the connection, then close and reopen the app.',
    'status.unsupported': 'Offline mode unavailable',
    'status.unsupportedHint': 'Open this page in Safari over https.',

    'install.title': 'Install the app',
    'install.ios': 'Tap Share, then Add to Home Screen, then open the app from the new icon.',
    'install.other': 'Use the browser menu to install the app or add it to the home screen, then open it from the new icon.',
    'install.note': 'Games are downloaded inside the installed app, where you choose the ones you want.',

    'update.text': 'Update available. Reload to update.',
    'update.reload': 'Reload',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.saves': 'Saves',
    'settings.export': 'Export saves',
    'settings.import': 'Import saves',
    'settings.exported': 'Exported {n} entries.',
    'settings.nothing': 'Nothing saved yet.',
    'settings.importConfirm': 'Import {n} entries? Entries with the same name will be replaced.',
    'settings.import.do': 'Import',
    'settings.imported': 'Imported {n} entries.',
    'settings.importError': "That file isn't a Cache Only save file.",
    'settings.device': 'This device',
    'settings.version': 'Version',
    'settings.offline': 'Offline',
    'settings.persisted': 'Storage persisted',
    'settings.games': 'Games downloaded',
    'settings.unsupported': 'Not supported',
    'settings.check': 'Check for update',
    'settings.checking': 'Checking…',
    'settings.upToDate': 'You have the latest version.',
    'settings.updateReady': 'Update downloaded. Reload to update.',
    'settings.unreachable': "Can't check for updates while offline. That's fine: everything keeps working.",
    'settings.updateFailed': "The update couldn't be downloaded. Try again later.",

    'difficulty.easy': 'Easy',
    'difficulty.medium': 'Medium',
    'difficulty.hard': 'Hard',
    'difficulty.expert': 'Expert',
    'difficulty.custom': 'Custom',

    'sudoku.givens': '{min}–{max} given numbers',
    'sudoku.generating': 'Generating…',
    'sudoku.paused': 'Paused',
    'sudoku.pause': 'Pause',
    'sudoku.resume': 'Resume',
    'sudoku.notes': 'Notes',
    'sudoku.erase': 'Erase',
    'sudoku.hint': 'Hint',
    'sudoku.menu': 'Game menu',
    'sudoku.newPuzzle': 'New puzzle',
    'sudoku.confirmNew': 'Start a new puzzle? The current one will be lost.',
    'sudoku.enter': 'Enter puzzle',
    'sudoku.enterHelp': 'Paste 81 digits, row by row. Use 0 or . for empty cells.',
    'sudoku.enterPlay': 'Play this puzzle',
    'sudoku.checking': 'Checking…',
    'sudoku.err.length': 'Needs exactly 81 cells; this has {n}.',
    'sudoku.err.chars': 'Only digits 0–9 and . are allowed.',
    'sudoku.err.conflict': 'Two equal numbers share a row, column or box.',
    'sudoku.err.none': 'This puzzle has no solution.',
    'sudoku.err.multiple': 'This puzzle has more than one solution.',
    'sudoku.share': 'Share this puzzle',
    'sudoku.shareHelp': 'Send these 81 digits to a friend. They paste them into Enter puzzle.',
    'sudoku.showConflicts': 'Show conflicts',
    'sudoku.solved': 'Solved!',
    'sudoku.time': 'Time',
    'sudoku.hints': 'Hints',
    'sudoku.difficulty': 'Difficulty',
    'sudoku.newBest': 'New best time!',
    'sudoku.best': 'Best times',
    'sudoku.cell': 'Row {r}, column {c}',
    'sudoku.empty': 'empty',
    'sudoku.notesList': 'notes {list}',
    'sudoku.board': 'Sudoku board',

    'g2048.score': 'Score',
    'g2048.best': 'Best',
    'g2048.won': 'You made 2048!',
    'g2048.wonText': 'Keep going for a bigger tile, or start over.',
    'g2048.keepPlaying': 'Keep playing',
    'g2048.over': 'No moves left',
    'g2048.overText': 'Final score {score}.',
    'g2048.hint': 'Swipe to slide the tiles. Equal numbers merge.',
    'g2048.confirmNew': 'Start a new game? This one will be lost.',
    'g2048.board': '2048 board',

    'tanks.title': 'Tanks',
    'tanks.board': 'Tank battle arena',
    'tanks.mission': 'Mission',
    'tanks.missionN': 'Mission {n}',
    'tanks.lives': 'Lives',
    'tanks.pause': 'Pause',
    'tanks.paused': 'Paused',
    'tanks.resume': 'Resume',
    'tanks.sound': 'Sound',
    'tanks.quit': 'Quit campaign',
    'tanks.confirmQuit': 'Quit this campaign? Its progress will be lost.',
    'tanks.intro': 'Shells bounce off walls once. Mines blow up striped crates. Clear all 20 missions.',
    'tanks.start': 'Start',
    'tanks.continue': 'Continue · mission {n}',
    'tanks.newCampaign': 'New campaign',
    'tanks.confirmNew': 'Start a new campaign? The current one will be lost.',
    'tanks.startAt': 'Start at',
    'tanks.record': 'Record: {kills} tanks · mission {mission}',
    'tanks.recordAll': 'Record: {kills} tanks · all missions cleared',
    'tanks.helpTouch': 'The left pad drives. Drag the right pad to aim and let go to fire, or tap the arena to fire at that spot. The round button lays a mine.',
    'tanks.helpKeys': 'WASD or the arrow keys drive. Aim with the mouse and click to fire. Space or right-click lays a mine. P pauses.',
    'tanks.enemies': 'Enemy tanks: {n}',
    'tanks.final': 'Final mission',
    'tanks.note.white': 'Some tanks here turn invisible. Watch for their tracks.',
    'tanks.note.red': 'Missiles here follow you. Shoot them down or lead them into a wall.',
    'tanks.note.olive': 'Mortars here lob bombs over walls. Get off the marks on the floor, or get in close.',
    'tanks.cleared': 'Mission cleared!',
    'tanks.bonus': 'Bonus tank!',
    'tanks.destroyed': 'Tank destroyed',
    'tanks.livesLeft': 'Lives left: {n}',
    'tanks.gameOver': 'Game over',
    'tanks.victory': 'All missions cleared!',
    'tanks.victoryShort': 'Campaign cleared!',
    'tanks.reached': 'Mission reached',
    'tanks.destroyedCount': 'Tanks destroyed',
    'tanks.newRecord': 'New record!',
    'tanks.playAgain': 'Play again',
    'tanks.move': 'Drive',
    'tanks.moveShort': 'Drive',
    'tanks.aim': 'Aim and fire',
    'tanks.aimShort': 'Aim · fire',
    'tanks.mine': 'Lay a mine',
    'tanks.type.brown': 'Brown',
    'tanks.type.ash': 'Grey',
    'tanks.type.marine': 'Teal',
    'tanks.type.yellow': 'Yellow',
    'tanks.type.pink': 'Pink',
    'tanks.type.green': 'Green',
    'tanks.type.violet': 'Violet',
    'tanks.type.white': 'White',
    'tanks.type.black': 'Black',
    'tanks.type.red': 'Red',
    'tanks.type.olive': 'Olive',
    'tanks.name.1': 'First contact',
    'tanks.name.2': 'Crossfire',
    'tanks.name.3': 'Patrol',
    'tanks.name.4': 'Crate gate',
    'tanks.name.5': 'Rocket range',
    'tanks.name.6': 'Switchbacks',
    'tanks.name.7': 'Bank shots',
    'tanks.name.8': 'Across the pits',
    'tanks.name.9': 'The maze',
    'tanks.name.10': 'Mirror match',
    'tanks.name.11': 'Pillboxes',
    'tanks.name.12': 'Lock-on',
    'tanks.name.13': 'Ghosts',
    'tanks.name.14': 'Hunter',
    'tanks.name.15': 'Artillery',
    'tanks.name.16': 'Crossroads',
    'tanks.name.17': 'Fortress',
    'tanks.name.18': 'Night shift',
    'tanks.name.19': 'Siege',
    'tanks.name.20': 'Last stand',
    'tanks.brief.1': 'One turret behind a wall. Drive round it, or bounce a shell in.',
    'tanks.brief.2': 'Three turrets cover the middle. Take them one at a time.',
    'tanks.brief.3': 'They patrol round the big block. Wait for them at a corner.',
    'tanks.brief.4': 'Striped crates stop shells. A mine blows them open.',
    'tanks.brief.5': 'Rockets never bounce: keep a pillar between you.',
    'tanks.brief.6': 'The corridors fold back on themselves. Watch the floor for mines.',
    'tanks.brief.7': "Shells bounce round corners here. A wall isn't always cover.",
    'tanks.brief.8': 'Shells fly over the holes. Tanks cross at the bridge.',
    'tanks.brief.9': 'Blind corners everywhere. Mind your own ricochets.',
    'tanks.brief.10': 'Two tanks with your loadout, in an arena that mirrors itself.',
    'tanks.brief.11': 'Two turrets in walled pockets. Work your way round them.',
    'tanks.brief.12': 'Pillars everywhere: keep one between you and each missile.',
    'tanks.brief.13': 'Crate alcoves everywhere, and something hiding in them.',
    'tanks.brief.14': 'A fast hunter. Use the loops to shake it off.',
    'tanks.brief.15': 'Two walled yards. Clear the open ground, then storm them.',
    'tanks.brief.16': 'Four arms and no cover in the middle. Cross fast.',
    'tanks.brief.17': 'The gates are crates. Bring mines.',
    'tanks.brief.18': 'Short walls, long shadows, and ghosts among them.',
    'tanks.brief.19': 'Mortars behind the line, hunters in front. Break through.',
    'tanks.brief.20': 'Every kind of tank at once. Good luck.',
  },

  ca: {
    'common.back': 'Torna als jocs',
    'common.cancel': 'Cancel·la',
    'common.close': 'Tanca',
    'common.copy': 'Copia',
    'common.copied': 'Copiat',
    'common.share': 'Comparteix',
    'common.yes': 'Sí',
    'common.no': 'No',
    'common.undo': 'Desfés',
    'common.redo': 'Refés',
    'common.newGame': 'Partida nova',

    'launcher.games': 'Jocs',
    'launcher.play': 'Juga',
    'launcher.resume': 'Continua',
    'launcher.score': '{score} punts',
    'launcher.mission': 'Missió {n}',
    'launcher.download': 'Baixa',
    'launcher.downloadGame': 'Baixa {name}, {size}',
    'launcher.downloadAll': 'Baixa-ho tot · {size}',
    'launcher.downloadingAll': 'Baixant {done} de {total}…',
    'launcher.downloading': 'Baixant…',
    'launcher.queued': 'En cua',
    'launcher.downloadFailed': "No s'ha pogut baixar. Toca per tornar-ho a provar.",
    'launcher.needsHost': "Connecta't a internet per baixar-lo",
    'launcher.settings': 'Configuració',
    'launcher.language': 'Idioma',

    'status.checking': 'Comprovant els fitxers…',
    'status.preparing': "Preparant l'app… {done}/{total}",
    'status.downloadingHint': "Mantén l'app oberta i amb connexió.",
    'status.ready': 'Llest sense connexió',
    'status.hostOnline': 'Amb connexió. Baixa els jocs que vulguis tenir.',
    'status.hostOffline': 'Sense connexió. Els jocs baixats funcionen igualment.',
    'status.allReady': 'Tots els jocs estan baixats. Ja pots activar el mode avió.',
    'status.failed': 'Ha fallat la baixada',
    'status.failedHint': "Comprova la connexió i torna a obrir l'app.",
    'status.unsupported': 'Mode sense connexió no disponible',
    'status.unsupportedHint': 'Obre aquesta pàgina amb Safari per https.',

    'install.title': "Instal·la l'app",
    'install.ios': "Toca Compartir, després Afegir a la pantalla d'inici, i obre l'app des de la icona nova.",
    'install.other': "Fes servir el menú del navegador per instal·lar l'app o afegir-la a la pantalla d'inici, i obre-la des de la icona nova.",
    'install.note': "Els jocs es baixen dins l'app instal·lada, on tries els que vulguis.",

    'update.text': 'Hi ha una actualització. Recarrega per actualitzar.',
    'update.reload': 'Recarrega',

    'settings.title': 'Configuració',
    'settings.language': 'Idioma',
    'settings.saves': 'Partides desades',
    'settings.export': 'Exporta les partides',
    'settings.import': 'Importa partides',
    'settings.exported': "S'han exportat {n} elements.",
    'settings.nothing': 'Encara no hi ha res desat.',
    'settings.importConfirm': 'Vols importar {n} elements? Se substituiran els que tinguin el mateix nom.',
    'settings.import.do': 'Importa',
    'settings.imported': "S'han importat {n} elements.",
    'settings.importError': 'Aquest fitxer no és una còpia de partides de Cache Only.',
    'settings.device': 'Aquest dispositiu',
    'settings.version': 'Versió',
    'settings.offline': 'Sense connexió',
    'settings.persisted': 'Emmagatzematge persistent',
    'settings.games': 'Jocs baixats',
    'settings.unsupported': 'No compatible',
    'settings.check': 'Cerca actualitzacions',
    'settings.checking': 'Comprovant…',
    'settings.upToDate': "Tens l'última versió.",
    'settings.updateReady': 'Actualització baixada. Recarrega per actualitzar.',
    'settings.unreachable': 'Sense connexió no es poden buscar actualitzacions. No passa res: tot continua funcionant.',
    'settings.updateFailed': "No s'ha pogut baixar l'actualització. Torna-ho a provar més tard.",

    'difficulty.easy': 'Fàcil',
    'difficulty.medium': 'Mitjà',
    'difficulty.hard': 'Difícil',
    'difficulty.expert': 'Expert',
    'difficulty.custom': 'Personalitzat',

    'sudoku.givens': '{min}–{max} números donats',
    'sudoku.generating': 'Generant…',
    'sudoku.paused': 'En pausa',
    'sudoku.pause': 'Pausa',
    'sudoku.resume': 'Continua',
    'sudoku.notes': 'Notes',
    'sudoku.erase': 'Esborra',
    'sudoku.hint': 'Pista',
    'sudoku.menu': 'Menú de la partida',
    'sudoku.newPuzzle': 'Sudoku nou',
    'sudoku.confirmNew': "Vols començar un sudoku nou? Perdràs l'actual.",
    'sudoku.enter': 'Introdueix un sudoku',
    'sudoku.enterHelp': 'Enganxa 81 xifres, fila per fila. Fes servir 0 o . per a les caselles buides.',
    'sudoku.enterPlay': 'Juga aquest sudoku',
    'sudoku.checking': 'Comprovant…',
    'sudoku.err.length': "Calen exactament 81 caselles; n'hi ha {n}.",
    'sudoku.err.chars': 'Només es permeten xifres del 0 al 9 i el punt.',
    'sudoku.err.conflict': 'Hi ha dos números iguals a la mateixa fila, columna o quadre.',
    'sudoku.err.none': 'Aquest sudoku no té solució.',
    'sudoku.err.multiple': "Aquest sudoku té més d'una solució.",
    'sudoku.share': 'Comparteix aquest sudoku',
    'sudoku.shareHelp': "Envia aquestes 81 xifres a algú. Les pot enganxar a «Introdueix un sudoku».",
    'sudoku.showConflicts': 'Mostra els conflictes',
    'sudoku.solved': 'Resolt!',
    'sudoku.time': 'Temps',
    'sudoku.hints': 'Pistes',
    'sudoku.difficulty': 'Dificultat',
    'sudoku.newBest': 'Nou millor temps!',
    'sudoku.best': 'Millors temps',
    'sudoku.cell': 'Fila {r}, columna {c}',
    'sudoku.empty': 'buida',
    'sudoku.notesList': 'notes {list}',
    'sudoku.board': 'Tauler del sudoku',

    'g2048.score': 'Punts',
    'g2048.best': 'Rècord',
    'g2048.won': 'Has fet 2048!',
    'g2048.wonText': 'Continua per fer una fitxa més gran, o torna a començar.',
    'g2048.keepPlaying': 'Continua jugant',
    'g2048.over': 'No queden moviments',
    'g2048.overText': 'Puntuació final: {score}.',
    'g2048.hint': "Llisca per moure les fitxes. Els números iguals s'uneixen.",
    'g2048.confirmNew': "Vols començar una partida nova? Perdràs l'actual.",
    'g2048.board': 'Tauler del 2048',

    'tanks.title': 'Tancs',
    'tanks.board': 'Arena de la batalla de tancs',
    'tanks.mission': 'Missió',
    'tanks.missionN': 'Missió {n}',
    'tanks.lives': 'Vides',
    'tanks.pause': 'Pausa',
    'tanks.paused': 'En pausa',
    'tanks.resume': 'Continua',
    'tanks.sound': 'So',
    'tanks.quit': 'Abandona la campanya',
    'tanks.confirmQuit': 'Vols abandonar aquesta campanya? En perdràs el progrés.',
    'tanks.intro': 'Els projectils reboten un cop a les parets. Les mines rebenten les caixes ratllades. Supera les 20 missions.',
    'tanks.start': 'Comença',
    'tanks.continue': 'Continua · missió {n}',
    'tanks.newCampaign': 'Campanya nova',
    'tanks.confirmNew': "Vols començar una campanya nova? Perdràs l'actual.",
    'tanks.startAt': 'Comença a',
    'tanks.record': 'Rècord: {kills} tancs · missió {mission}',
    'tanks.recordAll': 'Rècord: {kills} tancs · totes les missions superades',
    'tanks.helpTouch': "El comandament de l'esquerra condueix. Arrossega el de la dreta per apuntar i deixa'l anar per disparar, o toca l'arena per disparar a aquell punt. El botó rodó posa una mina.",
    'tanks.helpKeys': 'WASD o les fletxes condueixen. Apunta amb el ratolí i fes clic per disparar. Espai o clic dret posa una mina. P posa en pausa.',
    'tanks.enemies': 'Tancs enemics: {n}',
    'tanks.final': 'Última missió',
    'tanks.note.white': "Aquí alguns tancs es tornen invisibles. Fixa't en les rodades.",
    'tanks.note.red': 'Aquí els míssils et segueixen. Abat-los o fes que xoquin contra una paret.',
    'tanks.note.olive': "Aquí els morters llancen bombes per sobre de les parets. Surt de les marques del terra, o acosta-t'hi.",
    'tanks.cleared': 'Missió superada!',
    'tanks.bonus': 'Tanc extra!',
    'tanks.destroyed': 'Tanc destruït',
    'tanks.livesLeft': 'Vides restants: {n}',
    'tanks.gameOver': 'Fi de la partida',
    'tanks.victory': 'Totes les missions superades!',
    'tanks.victoryShort': 'Campanya superada!',
    'tanks.reached': 'Missió assolida',
    'tanks.destroyedCount': 'Tancs destruïts',
    'tanks.newRecord': 'Nou rècord!',
    'tanks.playAgain': 'Torna a jugar',
    'tanks.move': 'Condueix',
    'tanks.moveShort': 'Condueix',
    'tanks.aim': 'Apunta i dispara',
    'tanks.aimShort': 'Apunta · dispara',
    'tanks.mine': 'Posa una mina',
    'tanks.type.brown': 'Marró',
    'tanks.type.ash': 'Gris',
    'tanks.type.marine': 'Turquesa',
    'tanks.type.yellow': 'Groc',
    'tanks.type.pink': 'Rosa',
    'tanks.type.green': 'Verd',
    'tanks.type.violet': 'Lila',
    'tanks.type.white': 'Blanc',
    'tanks.type.black': 'Negre',
    'tanks.type.red': 'Vermell',
    'tanks.type.olive': 'Oliva',
    'tanks.name.1': 'Primer contacte',
    'tanks.name.2': 'Foc creuat',
    'tanks.name.3': 'Patrulla',
    'tanks.name.4': 'La porta de caixes',
    'tanks.name.5': 'Camp de tir',
    'tanks.name.6': 'Ziga-zaga',
    'tanks.name.7': 'Carambola',
    'tanks.name.8': 'Entre forats',
    'tanks.name.9': 'El laberint',
    'tanks.name.10': 'Partida de mirall',
    'tanks.name.11': 'Búnquers',
    'tanks.name.12': 'Blanc fixat',
    'tanks.name.13': 'Fantasmes',
    'tanks.name.14': 'Caçador',
    'tanks.name.15': 'Artilleria',
    'tanks.name.16': 'La cruïlla',
    'tanks.name.17': 'La fortalesa',
    'tanks.name.18': 'Torn de nit',
    'tanks.name.19': 'Setge',
    'tanks.name.20': "L'última batalla",
    'tanks.brief.1': 'Una torreta darrere una paret. Fes-li la volta, o fes-hi rebotar un projectil.',
    'tanks.brief.2': "Tres torretes cobreixen el centre. Elimina-les d'una en una.",
    'tanks.brief.3': "Fan voltes al bloc gran. Espera'ls a una cantonada.",
    'tanks.brief.4': 'Les caixes ratllades aturen els projectils. Una mina les rebenta.',
    'tanks.brief.5': 'Els coets no reboten mai: mantén un pilar entre vosaltres.',
    'tanks.brief.6': 'Els passadissos van i tornen. Vigila les mines a terra.',
    'tanks.brief.7': 'Aquí els projectils reboten i giren les cantonades. Una paret no sempre et protegeix.',
    'tanks.brief.8': 'Els projectils passen per sobre dels forats. Els tancs creuen pel pont.',
    'tanks.brief.9': 'Cantonades cegues pertot arreu. Compte amb els teus propis rebots.',
    'tanks.brief.10': 'Dos tancs armats com tu, en una arena simètrica.',
    'tanks.brief.11': 'Dues torretes dins de búnquers. Rodeja-les.',
    'tanks.brief.12': "Pilars pertot arreu: posa'n un entre tu i cada míssil.",
    'tanks.brief.13': 'Racons de caixes pertot arreu, i alguna cosa amagada a dins.',
    'tanks.brief.14': "Un caçador ràpid. Fes servir els circuits per treure-te'l de sobre.",
    'tanks.brief.15': "Dos patis tancats. Neteja el terreny obert i després assalta'ls.",
    'tanks.brief.16': 'Quatre braços i cap protecció al mig. Creua de pressa.',
    'tanks.brief.17': 'Les portes són de caixes. Porta mines.',
    'tanks.brief.18': 'Parets curtes, ombres llargues i fantasmes entre elles.',
    'tanks.brief.19': "Morters darrere la línia, caçadors al davant. Obre't pas.",
    'tanks.brief.20': 'Tots els tipus de tanc alhora. Sort!',
  },
};

function detect() {
  const saved = store.load('lang', 1);
  if (LANGS.includes(saved)) return saved;
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  for (const l of prefs) {
    const code = String(l).toLowerCase().slice(0, 2);
    if (LANGS.includes(code)) return code;
  }
  // Spanish (and other Iberian) phones are most likely friends in Catalonia.
  return prefs.some((l) => /^(es|oc|gl|eu)\b/i.test(l)) ? 'ca' : 'en';
}

let current = detect();
document.documentElement.lang = current;

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  current = lang;
  store.save('lang', 1, lang);
  document.documentElement.lang = lang;
  localize();
}

export function t(key, params) {
  let s = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

/** Text for a value that is either a plain string or an { en, ca } object. */
export function pick(value) {
  if (value && typeof value === 'object') return value[current] ?? value.en ?? '';
  return value ?? '';
}

/**
 * Fills [data-i18n] text and [data-i18n-label] aria-label/title under root.
 */
export function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    const label = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
  }
}

export function formatNumber(n) {
  return new Intl.NumberFormat(current === 'ca' ? 'ca' : 'en').format(n);
}

/** A download size such as "115 KB" or "1.4 MB" (in Catalan "1,4 MB"). */
export function formatBytes(bytes) {
  const locale = current === 'ca' ? 'ca' : 'en';
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

/** 0.42 -> "42%" (Catalan: "42 %"). */
export function formatPercent(fraction) {
  return new Intl.NumberFormat(current === 'ca' ? 'ca' : 'en', { style: 'percent' }).format(fraction);
}

/** ms -> "m:ss" or "h:mm:ss". */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}
