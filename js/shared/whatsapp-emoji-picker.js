// ============================================================================
// WhatsappUI.EmojiPicker — WA-Web-style popup emoji picker.
//
// Self-contained: no third-party deps. Curated dataset of ~600 emojis
// across 8 categories, with name + keyword search, recent-emoji memory
// (localStorage), and a category-tab footer.
//
// Usage:
//   WhatsappUI.EmojiPicker.open(anchorEl, (emoji) => {
//       textarea.value += emoji;
//   });
// Calling open() while the picker is already shown closes it (toggle).
// Click outside / Escape also closes.
//
// Why no library?
//   • emoji-mart, emoji-button etc. add 80–200 KB of bundle. We only need
//     a flat list + search; ~10 KB hand-rolled does the same job.
//   • No build step / no node_modules — drop-in for our static-served
//     vanilla-JS frontend.
// ============================================================================

(function (window) {
    'use strict';

    if (!window.WhatsappUI) window.WhatsappUI = {};

    // ── Curated emoji dataset ───────────────────────────────────────────────
    // Format: [emoji, "name keywords", category]
    //   Categories: p (people), n (nature), f (food), a (activity),
    //               t (travel), o (objects), s (symbols), g (flags)
    // Keywords are space-separated; the search just substring-matches them
    // along with the name. Keep names short — they're not displayed.
    const EMOJIS = [
        // ── Smileys & people ─────────────────────────────────────────────
        ['😀','grinning happy smile','p'],
        ['😃','smiley happy joy','p'],
        ['😄','smile happy joy laugh','p'],
        ['😁','beaming happy grin','p'],
        ['😆','laughing happy lol haha','p'],
        ['😅','sweat smile relief','p'],
        ['🤣','rofl laugh haha','p'],
        ['😂','joy laugh tears lol haha','p'],
        ['🙂','slight smile','p'],
        ['🙃','upside down silly','p'],
        ['🫠','melting hot disappear','p'],
        ['😉','wink flirt','p'],
        ['😊','blush smile happy','p'],
        ['😇','innocent angel halo','p'],
        ['🥰','smiling hearts love','p'],
        ['😍','heart eyes love','p'],
        ['🤩','star struck wow','p'],
        ['😘','kiss blow love','p'],
        ['😗','kiss','p'],
        ['☺️','smiling relaxed','p'],
        ['😚','kiss closed eyes','p'],
        ['😙','kiss smile','p'],
        ['🥲','smiling tear happy sad','p'],
        ['😋','yum tongue tasty','p'],
        ['😛','tongue out playful','p'],
        ['😜','wink tongue silly','p'],
        ['🤪','crazy zany silly','p'],
        ['😝','squinting tongue silly','p'],
        ['🤑','money mouth dollar','p'],
        ['🤗','hugging hug','p'],
        ['🤭','hand over mouth oops','p'],
        ['🤫','shushing quiet shh','p'],
        ['🤔','thinking hmm','p'],
        ['🤐','zipper mouth secret silent','p'],
        ['🤨','raised eyebrow skeptical','p'],
        ['😐','neutral meh','p'],
        ['😑','expressionless meh','p'],
        ['😶','no mouth speechless','p'],
        ['😏','smirk','p'],
        ['😒','unamused meh annoyed','p'],
        ['🙄','eye roll','p'],
        ['😬','grimacing awkward','p'],
        ['🤥','lying nose pinocchio','p'],
        ['😌','relieved peaceful','p'],
        ['😔','pensive sad','p'],
        ['😪','sleepy tired','p'],
        ['🤤','drooling drool','p'],
        ['😴','sleeping zzz tired','p'],
        ['😷','mask sick','p'],
        ['🤒','sick fever thermometer','p'],
        ['🤕','injured bandage hurt','p'],
        ['🤢','nauseated sick gross','p'],
        ['🤮','vomiting sick','p'],
        ['🤧','sneezing tissue cold sick','p'],
        ['🥵','hot heat sweat','p'],
        ['🥶','cold freezing','p'],
        ['🥴','woozy tipsy drunk','p'],
        ['😵','dizzy ko','p'],
        ['🤯','exploding mind blown','p'],
        ['🤠','cowboy hat','p'],
        ['🥳','partying celebrate hat','p'],
        ['🥸','disguised glasses mustache','p'],
        ['😎','cool sunglasses','p'],
        ['🤓','nerd glasses smart','p'],
        ['🧐','monocle inquiring','p'],
        ['😕','confused unsure','p'],
        ['🫤','diagonal mouth meh','p'],
        ['😟','worried concerned','p'],
        ['🙁','frowning sad','p'],
        ['☹️','frown sad','p'],
        ['😮','surprised wow','p'],
        ['😯','hushed quiet wow','p'],
        ['😲','astonished shocked wow','p'],
        ['😳','flushed embarrassed shocked','p'],
        ['🥺','pleading begging please','p'],
        ['🥹','holding back tears','p'],
        ['😦','frowning open mouth','p'],
        ['😧','anguished pained','p'],
        ['😨','fearful scared','p'],
        ['😰','anxious nervous sweat','p'],
        ['😥','sad relieved disappointed','p'],
        ['😢','crying tear sad','p'],
        ['😭','sobbing crying loud sad','p'],
        ['😱','screaming scared shocked','p'],
        ['😖','confounded frustrated','p'],
        ['😣','persevering struggle','p'],
        ['😞','disappointed sad','p'],
        ['😓','downcast sweat','p'],
        ['😩','weary tired exhausted','p'],
        ['😫','tired exhausted weary','p'],
        ['🥱','yawning tired','p'],
        ['😤','huffing frustrated angry','p'],
        ['😡','pouting angry mad','p'],
        ['😠','angry mad','p'],
        ['🤬','swearing curse angry','p'],
        ['😈','smiling devil mischief','p'],
        ['👿','angry devil mad','p'],
        ['💀','skull dead','p'],
        ['☠️','skull crossbones poison','p'],
        ['💩','poop','p'],
        ['🤡','clown joker','p'],
        ['👹','ogre monster','p'],
        ['👺','goblin monster','p'],
        ['👻','ghost spooky','p'],
        ['👽','alien ufo','p'],
        ['👾','space invader','p'],
        ['🤖','robot','p'],
        ['🎃','jack o lantern halloween pumpkin','p'],
        ['😺','smiling cat happy','p'],
        ['😸','grinning cat happy','p'],
        ['😹','tears joy cat laughing','p'],
        ['😻','heart eyes cat love','p'],
        ['😼','wry cat smirk','p'],
        ['😽','kissing cat','p'],
        ['🙀','weary cat scared','p'],
        ['😿','crying cat sad','p'],
        ['😾','pouting cat angry','p'],
        // hands & gestures
        ['👋','wave hi hello bye','p'],
        ['🤚','raised back hand stop','p'],
        ['🖐️','raised hand five','p'],
        ['✋','raised hand stop high five','p'],
        ['🖖','vulcan spock','p'],
        ['👌','ok hand perfect','p'],
        ['🤌','pinched fingers italian','p'],
        ['🤏','pinching small','p'],
        ['✌️','victory peace','p'],
        ['🤞','crossed fingers luck','p'],
        ['🫰','heart hands love finger','p'],
        ['🤟','love you ily','p'],
        ['🤘','rock horns metal','p'],
        ['🤙','call me hang loose','p'],
        ['👈','left point','p'],
        ['👉','right point','p'],
        ['👆','up point','p'],
        ['🖕','middle finger','p'],
        ['👇','down point','p'],
        ['☝️','index point up','p'],
        ['👍','thumbs up like yes ok','p'],
        ['👎','thumbs down dislike no','p'],
        ['✊','raised fist solidarity','p'],
        ['👊','fist bump punch','p'],
        ['🤛','left fist bump','p'],
        ['🤜','right fist bump','p'],
        ['👏','clapping applause','p'],
        ['🙌','raised hands praise yes','p'],
        ['👐','open hands','p'],
        ['🤲','palms up together pray','p'],
        ['🤝','handshake deal','p'],
        ['🙏','folded hands pray thanks please','p'],
        ['💪','flexed bicep strong','p'],
        ['🦾','mechanical arm','p'],
        // people
        ['👶','baby','p'],
        ['🧒','child','p'],
        ['👦','boy','p'],
        ['👧','girl','p'],
        ['🧑','person','p'],
        ['👨','man','p'],
        ['👩','woman','p'],
        ['🧓','older person','p'],
        ['👴','old man','p'],
        ['👵','old woman','p'],
        // hearts & love
        ['❤️','red heart love','s'],
        ['🧡','orange heart','s'],
        ['💛','yellow heart','s'],
        ['💚','green heart','s'],
        ['💙','blue heart','s'],
        ['💜','purple heart','s'],
        ['🖤','black heart','s'],
        ['🤍','white heart','s'],
        ['🤎','brown heart','s'],
        ['💔','broken heart sad','s'],
        ['❣️','heart exclamation','s'],
        ['💕','two hearts','s'],
        ['💞','revolving hearts','s'],
        ['💓','beating heart','s'],
        ['💗','growing heart','s'],
        ['💖','sparkling heart','s'],
        ['💘','heart arrow cupid','s'],
        ['💝','heart ribbon gift','s'],
        ['💟','heart decoration','s'],
        ['❤️‍🔥','heart on fire','s'],
        ['❤️‍🩹','mending heart','s'],
        ['💌','love letter','s'],
        ['💋','kiss mark lips','s'],

        // ── Animals & Nature ────────────────────────────────────────────
        ['🐶','dog puppy face','n'],
        ['🐱','cat kitten face','n'],
        ['🐭','mouse face','n'],
        ['🐹','hamster','n'],
        ['🐰','rabbit bunny face','n'],
        ['🦊','fox face','n'],
        ['🐻','bear face','n'],
        ['🐼','panda face','n'],
        ['🐨','koala face','n'],
        ['🐯','tiger face','n'],
        ['🦁','lion face','n'],
        ['🐮','cow face','n'],
        ['🐷','pig face','n'],
        ['🐸','frog face','n'],
        ['🐵','monkey face','n'],
        ['🙈','see no evil monkey','n'],
        ['🙉','hear no evil monkey','n'],
        ['🙊','speak no evil monkey','n'],
        ['🐒','monkey','n'],
        ['🦍','gorilla','n'],
        ['🐔','chicken','n'],
        ['🐧','penguin','n'],
        ['🐦','bird','n'],
        ['🐤','baby chick','n'],
        ['🦆','duck','n'],
        ['🦅','eagle','n'],
        ['🦉','owl','n'],
        ['🐺','wolf','n'],
        ['🐗','boar','n'],
        ['🐴','horse face','n'],
        ['🦄','unicorn','n'],
        ['🐝','bee','n'],
        ['🐛','bug caterpillar','n'],
        ['🦋','butterfly','n'],
        ['🐌','snail','n'],
        ['🐞','ladybug','n'],
        ['🐢','turtle','n'],
        ['🐍','snake','n'],
        ['🐙','octopus','n'],
        ['🐠','tropical fish','n'],
        ['🐟','fish','n'],
        ['🐬','dolphin','n'],
        ['🦈','shark','n'],
        ['🐳','spouting whale','n'],
        ['🐋','whale','n'],
        ['🐊','crocodile','n'],
        ['🐅','tiger','n'],
        ['🐆','leopard','n'],
        ['🐃','water buffalo','n'],
        ['🐂','ox','n'],
        ['🐄','cow','n'],
        ['🦌','deer','n'],
        ['🐪','camel','n'],
        ['🐘','elephant','n'],
        ['🦏','rhinoceros','n'],
        ['🐎','horse','n'],
        ['🐖','pig','n'],
        ['🐏','ram','n'],
        ['🐑','sheep','n'],
        ['🐐','goat','n'],
        ['🦓','zebra','n'],
        ['🦔','hedgehog','n'],
        ['🐇','rabbit','n'],
        ['🐀','rat','n'],
        ['🐁','mouse','n'],
        ['🐉','dragon','n'],
        ['🐾','paw prints','n'],
        ['🌵','cactus','n'],
        ['🎄','christmas tree','n'],
        ['🌲','evergreen tree','n'],
        ['🌳','tree','n'],
        ['🌴','palm tree','n'],
        ['🌱','seedling','n'],
        ['🌿','herb','n'],
        ['☘️','shamrock','n'],
        ['🍀','four leaf clover lucky','n'],
        ['🍃','leaves','n'],
        ['🍂','fallen leaves autumn','n'],
        ['🍁','maple leaf','n'],
        ['🌾','sheaf rice','n'],
        ['🌷','tulip','n'],
        ['🌹','rose flower','n'],
        ['🥀','wilted flower','n'],
        ['🌻','sunflower','n'],
        ['🌼','blossom flower','n'],
        ['🌸','cherry blossom','n'],
        ['💐','bouquet flowers','n'],
        ['🌞','sun face','n'],
        ['🌝','full moon face','n'],
        ['🌚','new moon face','n'],
        ['🌙','crescent moon','n'],
        ['🌛','first quarter moon face','n'],
        ['🌜','last quarter moon face','n'],
        ['🌎','globe americas','n'],
        ['🌍','globe africa europe','n'],
        ['🌏','globe asia','n'],
        ['💫','dizzy stars','n'],
        ['⭐','star','n'],
        ['🌟','glowing star','n'],
        ['✨','sparkles glitter','n'],
        ['☄️','comet','n'],
        ['💥','collision boom','n'],
        ['🔥','fire flame lit','n'],
        ['🌪️','tornado','n'],
        ['🌈','rainbow','n'],
        ['☀️','sun','n'],
        ['⛅','partly cloudy','n'],
        ['☁️','cloud','n'],
        ['❄️','snowflake','n'],
        ['☃️','snowman','n'],
        ['⛄','snowman without snow','n'],
        ['💧','droplet water','n'],
        ['💦','sweat drops','n'],
        ['🌊','wave ocean','n'],

        // ── Food & Drink ────────────────────────────────────────────────
        ['🍎','red apple','f'],
        ['🍏','green apple','f'],
        ['🍐','pear','f'],
        ['🍊','tangerine orange','f'],
        ['🍋','lemon','f'],
        ['🍌','banana','f'],
        ['🍉','watermelon','f'],
        ['🍇','grapes','f'],
        ['🍓','strawberry','f'],
        ['🫐','blueberries','f'],
        ['🍈','melon','f'],
        ['🍒','cherries','f'],
        ['🍑','peach','f'],
        ['🥭','mango','f'],
        ['🍍','pineapple','f'],
        ['🥥','coconut','f'],
        ['🥝','kiwi','f'],
        ['🍅','tomato','f'],
        ['🍆','eggplant aubergine','f'],
        ['🥑','avocado','f'],
        ['🥦','broccoli','f'],
        ['🥬','leafy green','f'],
        ['🥒','cucumber','f'],
        ['🌶️','hot pepper chili','f'],
        ['🌽','corn','f'],
        ['🥕','carrot','f'],
        ['🥔','potato','f'],
        ['🍠','sweet potato','f'],
        ['🥐','croissant','f'],
        ['🥯','bagel','f'],
        ['🍞','bread loaf','f'],
        ['🥖','baguette','f'],
        ['🥨','pretzel','f'],
        ['🧀','cheese','f'],
        ['🥚','egg','f'],
        ['🍳','cooking egg','f'],
        ['🧈','butter','f'],
        ['🥞','pancakes','f'],
        ['🧇','waffle','f'],
        ['🥓','bacon','f'],
        ['🥩','steak meat','f'],
        ['🍗','poultry leg drumstick','f'],
        ['🍖','meat bone','f'],
        ['🌭','hot dog','f'],
        ['🍔','burger hamburger','f'],
        ['🍟','fries','f'],
        ['🍕','pizza','f'],
        ['🥪','sandwich','f'],
        ['🌮','taco','f'],
        ['🌯','burrito','f'],
        ['🥙','stuffed flatbread','f'],
        ['🍝','spaghetti pasta','f'],
        ['🍜','ramen noodles','f'],
        ['🍲','pot food stew','f'],
        ['🍛','curry rice','f'],
        ['🍣','sushi','f'],
        ['🍱','bento','f'],
        ['🥟','dumpling','f'],
        ['🍤','fried shrimp','f'],
        ['🍙','rice ball','f'],
        ['🍚','rice bowl','f'],
        ['🍘','rice cracker','f'],
        ['🍢','oden','f'],
        ['🍡','dango','f'],
        ['🍧','shaved ice','f'],
        ['🍨','ice cream','f'],
        ['🍦','soft serve ice cream','f'],
        ['🥧','pie','f'],
        ['🧁','cupcake','f'],
        ['🍰','cake slice','f'],
        ['🎂','birthday cake','f'],
        ['🍮','custard pudding','f'],
        ['🍭','lollipop','f'],
        ['🍬','candy','f'],
        ['🍫','chocolate bar','f'],
        ['🍿','popcorn','f'],
        ['🍩','donut doughnut','f'],
        ['🍪','cookie','f'],
        ['🥜','peanuts','f'],
        ['🍯','honey pot','f'],
        ['🥛','milk','f'],
        ['🍼','baby bottle','f'],
        ['☕','coffee','f'],
        ['🍵','tea cup','f'],
        ['🧃','juice box','f'],
        ['🥤','cup straw soda','f'],
        ['🧋','bubble tea','f'],
        ['🍶','sake','f'],
        ['🍺','beer','f'],
        ['🍻','beers cheers','f'],
        ['🥂','clinking glasses cheers','f'],
        ['🍷','wine','f'],
        ['🥃','tumbler whiskey','f'],
        ['🍸','cocktail martini','f'],
        ['🍹','tropical drink','f'],
        ['🧊','ice cube','f'],
        ['🥄','spoon','f'],
        ['🍴','fork knife','f'],
        ['🍽️','plate fork knife','f'],
        ['🥢','chopsticks','f'],

        // ── Activity ────────────────────────────────────────────────────
        ['⚽','soccer football','a'],
        ['🏀','basketball','a'],
        ['🏈','american football','a'],
        ['⚾','baseball','a'],
        ['🥎','softball','a'],
        ['🎾','tennis','a'],
        ['🏐','volleyball','a'],
        ['🏉','rugby','a'],
        ['🥏','frisbee','a'],
        ['🎱','pool 8 ball','a'],
        ['🏓','ping pong','a'],
        ['🏸','badminton','a'],
        ['🏒','ice hockey','a'],
        ['🏑','field hockey','a'],
        ['🥍','lacrosse','a'],
        ['🏏','cricket','a'],
        ['🥅','goal net','a'],
        ['⛳','flag in hole golf','a'],
        ['🪁','kite','a'],
        ['🏹','bow arrow archery','a'],
        ['🎣','fishing rod','a'],
        ['🥊','boxing glove','a'],
        ['🥋','martial arts','a'],
        ['🎽','running shirt','a'],
        ['🛹','skateboard','a'],
        ['🛼','roller skate','a'],
        ['⛸️','ice skate','a'],
        ['🎿','skis','a'],
        ['🏂','snowboarder','a'],
        ['🏋️','weight lifter','a'],
        ['🤸','cartwheel','a'],
        ['🤺','fencer','a'],
        ['🏌️','golfer','a'],
        ['🏇','horse racing','a'],
        ['🧘','meditation yoga','a'],
        ['🏄','surfer','a'],
        ['🏊','swimming','a'],
        ['🚣','rowing','a'],
        ['🧗','climbing','a'],
        ['🚴','cycling','a'],
        ['🚵','mountain biking','a'],
        ['🏆','trophy','a'],
        ['🥇','first place gold medal','a'],
        ['🥈','silver medal','a'],
        ['🥉','bronze medal','a'],
        ['🏅','sports medal','a'],
        ['🎖️','military medal','a'],
        ['🎟️','ticket','a'],
        ['🎫','admission ticket','a'],
        ['🎪','circus tent','a'],
        ['🎭','performing arts theater','a'],
        ['🎨','artist palette art','a'],
        ['🎬','clapper movie','a'],
        ['🎤','microphone karaoke','a'],
        ['🎧','headphones music','a'],
        ['🎼','musical score','a'],
        ['🎹','piano keyboard','a'],
        ['🥁','drum','a'],
        ['🎷','saxophone','a'],
        ['🎺','trumpet','a'],
        ['🎸','guitar','a'],
        ['🎻','violin','a'],
        ['🎲','dice','a'],
        ['🎯','dart bullseye','a'],
        ['🎳','bowling','a'],
        ['🎮','video game controller','a'],
        ['🎰','slot machine','a'],
        ['🧩','puzzle piece','a'],

        // ── Travel & Places ─────────────────────────────────────────────
        ['🚗','car','t'],
        ['🚕','taxi','t'],
        ['🚙','suv','t'],
        ['🚌','bus','t'],
        ['🚎','trolleybus','t'],
        ['🏎️','race car','t'],
        ['🚓','police car','t'],
        ['🚑','ambulance','t'],
        ['🚒','fire truck','t'],
        ['🚐','minibus','t'],
        ['🛻','pickup truck','t'],
        ['🚚','truck delivery','t'],
        ['🚛','articulated lorry','t'],
        ['🚜','tractor','t'],
        ['🛴','scooter kick','t'],
        ['🚲','bicycle bike','t'],
        ['🛵','motor scooter','t'],
        ['🏍️','motorcycle','t'],
        ['🚨','police light','t'],
        ['🚍','oncoming bus','t'],
        ['🚘','oncoming car','t'],
        ['🚖','oncoming taxi','t'],
        ['🚃','railway car','t'],
        ['🚆','train','t'],
        ['🚇','metro subway','t'],
        ['🚊','tram','t'],
        ['🚉','station','t'],
        ['🚄','high speed train','t'],
        ['🚅','bullet train','t'],
        ['✈️','airplane plane','t'],
        ['🛫','airplane departure','t'],
        ['🛬','airplane arrival','t'],
        ['💺','seat','t'],
        ['🛰️','satellite','t'],
        ['🚀','rocket','t'],
        ['🛸','flying saucer ufo','t'],
        ['🚁','helicopter','t'],
        ['🛶','canoe','t'],
        ['⛵','sailboat','t'],
        ['🚤','speedboat','t'],
        ['🛥️','motor boat','t'],
        ['🛳️','passenger ship','t'],
        ['⛴️','ferry','t'],
        ['🚢','ship','t'],
        ['⚓','anchor','t'],
        ['⛽','fuel pump gas','t'],
        ['🚧','construction','t'],
        ['🚦','vertical traffic light','t'],
        ['🚥','horizontal traffic light','t'],
        ['🗺️','world map','t'],
        ['🗽','statue of liberty','t'],
        ['🗼','tokyo tower','t'],
        ['🏰','castle','t'],
        ['🏯','japanese castle','t'],
        ['🏟️','stadium','t'],
        ['🎡','ferris wheel','t'],
        ['🎢','roller coaster','t'],
        ['🎠','carousel','t'],
        ['⛲','fountain','t'],
        ['🏖️','beach','t'],
        ['🏝️','desert island','t'],
        ['🏜️','desert','t'],
        ['🌋','volcano','t'],
        ['⛰️','mountain','t'],
        ['🏔️','snow capped mountain','t'],
        ['🗻','mount fuji','t'],
        ['🏕️','camping','t'],
        ['⛺','tent','t'],
        ['🏠','house home','t'],
        ['🏡','house with garden','t'],
        ['🏘️','houses','t'],
        ['🏗️','construction crane','t'],
        ['🏭','factory','t'],
        ['🏢','office building','t'],
        ['🏬','department store','t'],
        ['🏥','hospital','t'],
        ['🏦','bank','t'],
        ['🏨','hotel','t'],
        ['🏪','convenience store','t'],
        ['🏫','school','t'],
        ['💒','wedding','t'],
        ['🏛️','classical building','t'],
        ['⛪','church','t'],
        ['🕌','mosque','t'],
        ['🕍','synagogue','t'],
        ['🛕','hindu temple','t'],
        ['🌃','night cityscape','t'],
        ['🌆','sunset cityscape','t'],
        ['🌇','sunset','t'],
        ['🌉','bridge night','t'],

        // ── Objects ─────────────────────────────────────────────────────
        ['⌚','watch','o'],
        ['📱','mobile phone iphone','o'],
        ['📲','phone arrow','o'],
        ['💻','laptop','o'],
        ['⌨️','keyboard','o'],
        ['🖥️','desktop computer','o'],
        ['🖨️','printer','o'],
        ['🖱️','mouse computer','o'],
        ['💽','minidisc','o'],
        ['💾','floppy disk save','o'],
        ['💿','disc cd','o'],
        ['📀','dvd','o'],
        ['📷','camera','o'],
        ['📸','camera flash','o'],
        ['📹','video camera','o'],
        ['🎥','movie camera','o'],
        ['📽️','film projector','o'],
        ['📞','telephone receiver','o'],
        ['☎️','telephone','o'],
        ['📟','pager','o'],
        ['📠','fax','o'],
        ['📺','television tv','o'],
        ['📻','radio','o'],
        ['🎙️','studio microphone','o'],
        ['⏰','alarm clock','o'],
        ['⏱️','stopwatch','o'],
        ['⏲️','timer','o'],
        ['🕰️','mantelpiece clock','o'],
        ['⌛','hourglass done','o'],
        ['⏳','hourglass flowing','o'],
        ['📡','satellite antenna','o'],
        ['🔋','battery','o'],
        ['🔌','plug electric','o'],
        ['💡','light bulb idea','o'],
        ['🔦','flashlight','o'],
        ['🕯️','candle','o'],
        ['🧯','fire extinguisher','o'],
        ['💸','money with wings','o'],
        ['💵','dollar bill','o'],
        ['💴','yen','o'],
        ['💶','euro','o'],
        ['💷','pound','o'],
        ['🪙','coin','o'],
        ['💰','money bag','o'],
        ['💳','credit card','o'],
        ['💎','gem diamond','o'],
        ['⚖️','balance scale','o'],
        ['🧰','toolbox','o'],
        ['🔧','wrench','o'],
        ['🔨','hammer','o'],
        ['⚒️','hammer pick','o'],
        ['🛠️','hammer wrench','o'],
        ['⛏️','pick','o'],
        ['🔩','nut bolt','o'],
        ['⚙️','gear','o'],
        ['🧱','brick','o'],
        ['⛓️','chains','o'],
        ['🧲','magnet','o'],
        ['🔫','water pistol','o'],
        ['💣','bomb','o'],
        ['🧨','firecracker','o'],
        ['🔪','knife','o'],
        ['🛡️','shield','o'],
        ['🚬','cigarette smoke','o'],
        ['⚰️','coffin','o'],
        ['⚱️','funeral urn','o'],
        ['🏺','amphora','o'],
        ['🔮','crystal ball','o'],
        ['📿','prayer beads','o'],
        ['🧿','nazar amulet','o'],
        ['💈','barber pole','o'],
        ['⚗️','alembic','o'],
        ['🔭','telescope','o'],
        ['🔬','microscope','o'],
        ['🩹','bandage','o'],
        ['🩺','stethoscope','o'],
        ['💊','pill','o'],
        ['💉','syringe','o'],
        ['🩸','blood drop','o'],
        ['🧬','dna','o'],
        ['🦠','microbe germ','o'],
        ['🧪','test tube','o'],
        ['🌡️','thermometer','o'],
        ['🧹','broom','o'],
        ['🧺','basket','o'],
        ['🧻','toilet paper','o'],
        ['🚽','toilet','o'],
        ['🚰','potable water','o'],
        ['🚿','shower','o'],
        ['🛁','bathtub','o'],
        ['🧼','soap','o'],
        ['🪥','toothbrush','o'],
        ['🪒','razor','o'],
        ['🧽','sponge','o'],
        ['🛎️','bellhop bell','o'],
        ['🔑','key','o'],
        ['🗝️','old key','o'],
        ['🚪','door','o'],
        ['🪑','chair','o'],
        ['🛋️','couch lamp','o'],
        ['🛏️','bed','o'],
        ['🛌','person in bed','o'],
        ['🧸','teddy bear','o'],
        ['🖼️','framed picture','o'],
        ['🛍️','shopping bags','o'],
        ['🛒','shopping cart','o'],
        ['🎁','gift wrapped present','o'],
        ['🎈','balloon','o'],
        ['🎀','ribbon bow','o'],
        ['🎊','confetti ball','o'],
        ['🎉','party popper celebrate','o'],
        ['🎎','japanese dolls','o'],
        ['🏮','red paper lantern','o'],
        ['🎐','wind chime','o'],
        ['✉️','envelope mail','o'],
        ['📩','envelope arrow','o'],
        ['📨','incoming envelope','o'],
        ['📧','email','o'],
        ['📥','inbox tray','o'],
        ['📤','outbox tray','o'],
        ['📦','package box','o'],
        ['🏷️','label tag','o'],
        ['📜','scroll','o'],
        ['📃','page curl','o'],
        ['📄','page facing up','o'],
        ['📑','bookmark tabs','o'],
        ['🧾','receipt','o'],
        ['📊','bar chart','o'],
        ['📈','chart up','o'],
        ['📉','chart down','o'],
        ['🗒️','spiral notepad','o'],
        ['🗓️','spiral calendar','o'],
        ['📆','tear off calendar','o'],
        ['📅','calendar','o'],
        ['🗑️','wastebasket trash','o'],
        ['📋','clipboard','o'],
        ['📁','file folder','o'],
        ['📂','open file folder','o'],
        ['🗞️','rolled newspaper','o'],
        ['📰','newspaper','o'],
        ['📓','notebook','o'],
        ['📕','closed book','o'],
        ['📗','green book','o'],
        ['📘','blue book','o'],
        ['📙','orange book','o'],
        ['📚','books','o'],
        ['📖','open book','o'],
        ['🔖','bookmark','o'],
        ['🔗','link','o'],
        ['📎','paperclip','o'],
        ['📐','triangular ruler','o'],
        ['📏','straight ruler','o'],
        ['🧮','abacus','o'],
        ['📌','pushpin','o'],
        ['📍','round pushpin','o'],
        ['✂️','scissors','o'],
        ['🖊️','pen','o'],
        ['🖋️','fountain pen','o'],
        ['✒️','black nib','o'],
        ['🖌️','paintbrush','o'],
        ['🖍️','crayon','o'],
        ['📝','memo pencil','o'],
        ['✏️','pencil','o'],
        ['🔍','magnifying glass left','o'],
        ['🔎','magnifying glass right','o'],
        ['🔒','lock','o'],
        ['🔓','unlock','o'],
        ['🔏','locked pen','o'],
        ['🔐','locked key','o'],

        // ── Symbols ─────────────────────────────────────────────────────
        ['☮️','peace','s'],
        ['✝️','latin cross','s'],
        ['☪️','star and crescent','s'],
        ['🕉️','om','s'],
        ['☸️','wheel of dharma','s'],
        ['✡️','star of david','s'],
        ['🔯','six pointed star','s'],
        ['🕎','menorah','s'],
        ['☯️','yin yang','s'],
        ['☦️','orthodox cross','s'],
        ['🛐','place of worship','s'],
        ['⛎','ophiuchus','s'],
        ['♈','aries','s'],
        ['♉','taurus','s'],
        ['♊','gemini','s'],
        ['♋','cancer','s'],
        ['♌','leo','s'],
        ['♍','virgo','s'],
        ['♎','libra','s'],
        ['♏','scorpio','s'],
        ['♐','sagittarius','s'],
        ['♑','capricorn','s'],
        ['♒','aquarius','s'],
        ['♓','pisces','s'],
        ['🆔','id','s'],
        ['⚛️','atom','s'],
        ['☢️','radioactive','s'],
        ['☣️','biohazard','s'],
        ['❌','cross x','s'],
        ['⭕','hollow red circle','s'],
        ['🛑','stop sign','s'],
        ['⛔','no entry','s'],
        ['🚫','prohibited','s'],
        ['💯','hundred 100','s'],
        ['💢','anger','s'],
        ['♨️','hot springs','s'],
        ['🚭','no smoking','s'],
        ['❗','exclamation','s'],
        ['❕','white exclamation','s'],
        ['❓','question','s'],
        ['❔','white question','s'],
        ['‼️','double exclamation','s'],
        ['⁉️','exclamation question','s'],
        ['⚠️','warning','s'],
        ['🔱','trident','s'],
        ['♻️','recycle','s'],
        ['✅','check mark green','s'],
        ['☑️','ballot check','s'],
        ['✔️','check mark','s'],
        ['❎','cross mark button','s'],
        ['Ⓜ️','m','s'],
        ['♿','wheelchair','s'],
        ['🅿️','parking p','s'],
        ['ℹ️','information','s'],
        ['🆖','ng','s'],
        ['🆗','ok','s'],
        ['🆙','up','s'],
        ['🆒','cool','s'],
        ['🆕','new','s'],
        ['🆓','free','s'],
        ['0️⃣','zero','s'],
        ['1️⃣','one','s'],
        ['2️⃣','two','s'],
        ['3️⃣','three','s'],
        ['4️⃣','four','s'],
        ['5️⃣','five','s'],
        ['6️⃣','six','s'],
        ['7️⃣','seven','s'],
        ['8️⃣','eight','s'],
        ['9️⃣','nine','s'],
        ['🔟','ten','s'],
        ['#️⃣','hash','s'],
        ['*️⃣','asterisk','s'],
        ['▶️','play','s'],
        ['⏸️','pause','s'],
        ['⏹️','stop','s'],
        ['⏺️','record','s'],
        ['⏭️','next track','s'],
        ['⏮️','previous track','s'],
        ['⏩','fast forward','s'],
        ['⏪','rewind','s'],
        ['◀️','reverse','s'],
        ['🔼','up button','s'],
        ['🔽','down button','s'],
        ['➡️','right arrow','s'],
        ['⬅️','left arrow','s'],
        ['⬆️','up arrow','s'],
        ['⬇️','down arrow','s'],
        ['↗️','up right arrow','s'],
        ['↘️','down right arrow','s'],
        ['↙️','down left arrow','s'],
        ['↖️','up left arrow','s'],
        ['↕️','up down arrow','s'],
        ['↔️','left right arrow','s'],
        ['🔀','shuffle','s'],
        ['🔁','repeat','s'],
        ['🔂','repeat one','s'],
        ['🔄','refresh arrows','s'],
        ['🎵','musical note','s'],
        ['🎶','musical notes','s'],
        ['➕','plus','s'],
        ['➖','minus','s'],
        ['➗','divide','s'],
        ['✖️','multiply','s'],
        ['♾️','infinity','s'],
        ['💲','dollar sign','s'],
        ['💱','currency exchange','s'],
        ['™️','trademark','s'],
        ['©️','copyright','s'],
        ['®️','registered','s'],
        ['🔚','end','s'],
        ['🔙','back','s'],
        ['🔛','on','s'],
        ['🔝','top','s'],
        ['🔜','soon','s'],
        ['🔘','radio button','s'],
        ['🔴','red circle','s'],
        ['🟠','orange circle','s'],
        ['🟡','yellow circle','s'],
        ['🟢','green circle','s'],
        ['🔵','blue circle','s'],
        ['🟣','purple circle','s'],
        ['⚫','black circle','s'],
        ['⚪','white circle','s'],
        ['🟤','brown circle','s'],
        ['🔺','red triangle pointing up','s'],
        ['🔻','red triangle pointing down','s'],
        ['🔸','small orange diamond','s'],
        ['🔹','small blue diamond','s'],
        ['🔶','large orange diamond','s'],
        ['🔷','large blue diamond','s'],
        ['🔳','white square button','s'],
        ['🔲','black square button','s'],
        ['⬛','black large square','s'],
        ['⬜','white large square','s'],
        ['🟧','orange square','s'],
        ['🟨','yellow square','s'],
        ['🟩','green square','s'],
        ['🟦','blue square','s'],
        ['🟪','purple square','s'],
        ['🟫','brown square','s'],
        ['🔈','speaker low','s'],
        ['🔇','muted speaker','s'],
        ['🔉','speaker medium','s'],
        ['🔊','speaker high loud','s'],
        ['🔔','bell notification','s'],
        ['🔕','bell with slash','s'],
        ['📣','megaphone','s'],
        ['📢','loudspeaker','s'],
        ['💬','speech balloon chat','s'],
        ['💭','thought balloon','s'],
        ['🗯️','right anger bubble','s'],
        ['♠️','spade','s'],
        ['♣️','club','s'],
        ['♥️','heart suit','s'],
        ['♦️','diamond suit','s'],
        ['🃏','joker','s'],

        // ── Flags (most-used, alphabetical-ish) ─────────────────────────
        ['🏁','checkered flag','g'],
        ['🚩','triangular flag','g'],
        ['🎌','crossed flags','g'],
        ['🏴','black flag','g'],
        ['🏳️','white flag','g'],
        ['🏳️‍🌈','rainbow pride flag','g'],
        ['🏳️‍⚧️','transgender flag','g'],
        ['🏴‍☠️','pirate flag','g'],
        ['🇮🇳','india','g'],
        ['🇺🇸','united states usa america','g'],
        ['🇬🇧','united kingdom uk britain','g'],
        ['🇨🇦','canada','g'],
        ['🇦🇺','australia','g'],
        ['🇩🇪','germany deutschland','g'],
        ['🇫🇷','france','g'],
        ['🇮🇹','italy','g'],
        ['🇪🇸','spain','g'],
        ['🇯🇵','japan','g'],
        ['🇰🇷','south korea','g'],
        ['🇨🇳','china','g'],
        ['🇷🇺','russia','g'],
        ['🇧🇷','brazil','g'],
        ['🇲🇽','mexico','g'],
        ['🇳🇱','netherlands','g'],
        ['🇸🇪','sweden','g'],
        ['🇨🇭','switzerland','g'],
        ['🇦🇪','uae emirates','g'],
        ['🇸🇦','saudi arabia','g'],
        ['🇿🇦','south africa','g'],
        ['🇸🇬','singapore','g'],
        ['🇮🇩','indonesia','g'],
        ['🇹🇭','thailand','g'],
        ['🇵🇭','philippines','g'],
        ['🇲🇾','malaysia','g'],
        ['🇻🇳','vietnam','g'],
        ['🇵🇰','pakistan','g'],
        ['🇧🇩','bangladesh','g'],
        ['🇱🇰','sri lanka','g'],
        ['🇳🇵','nepal','g'],
        ['🇮🇱','israel','g'],
        ['🇹🇷','turkey','g'],
        ['🇪🇬','egypt','g'],
        ['🇳🇬','nigeria','g'],
        ['🇰🇪','kenya','g'],
        ['🇬🇭','ghana','g'],
        ['🇦🇷','argentina','g'],
        ['🇨🇱','chile','g'],
        ['🇨🇴','colombia','g'],
        ['🇵🇹','portugal','g'],
        ['🇮🇪','ireland','g'],
        ['🇧🇪','belgium','g'],
        ['🇩🇰','denmark','g'],
        ['🇫🇮','finland','g'],
        ['🇳🇴','norway','g'],
        ['🇵🇱','poland','g'],
        ['🇬🇷','greece','g'],
        ['🇨🇿','czech republic','g'],
        ['🇦🇹','austria','g'],
        ['🇭🇺','hungary','g'],
        ['🇷🇴','romania','g'],
        ['🇺🇦','ukraine','g'],
    ];

    const CATEGORIES = [
        { code: 'r', icon: '🕐', label: 'Recent' },
        { code: 'p', icon: '😀', label: 'Smileys & people' },
        { code: 'n', icon: '🐶', label: 'Animals & nature' },
        { code: 'f', icon: '🍎', label: 'Food & drink' },
        { code: 'a', icon: '⚽', label: 'Activity' },
        { code: 't', icon: '🚗', label: 'Travel & places' },
        { code: 'o', icon: '💡', label: 'Objects' },
        { code: 's', icon: '#️⃣', label: 'Symbols' },
        { code: 'g', icon: '🏳️', label: 'Flags' },
    ];

    const RECENT_KEY = 'wep_recent_emojis_v1';
    const RECENT_LIMIT = 24;

    let _popup = null;          // current open popup element
    let _outsideHandler = null;
    let _escHandler = null;

    function loadRecent() {
        try {
            const raw = localStorage.getItem(RECENT_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.slice(0, RECENT_LIMIT) : [];
        } catch { return []; }
    }
    function saveRecent(emoji) {
        try {
            const cur = loadRecent().filter(e => e !== emoji);
            cur.unshift(emoji);
            localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_LIMIT)));
        } catch {}
    }

    function buildBody(filterText) {
        const term = (filterText || '').toLowerCase().trim();
        const sectionsHtml = [];

        if (!term) {
            // Recent section first (only when search empty)
            const recents = loadRecent();
            if (recents.length > 0) {
                sectionsHtml.push(renderSection('Recent', recents));
            }
            // Then each category in order
            for (const cat of CATEGORIES) {
                if (cat.code === 'r') continue;
                const items = EMOJIS.filter(e => e[2] === cat.code).map(e => e[0]);
                if (items.length > 0) {
                    sectionsHtml.push(renderSection(cat.label, items, cat.code));
                }
            }
        } else {
            // Search across all
            const hits = EMOJIS.filter(e => e[1].includes(term)).map(e => e[0]);
            if (hits.length === 0) {
                sectionsHtml.push(`<div class="wep-empty">No emoji matches "${escapeHtml(term)}"</div>`);
            } else {
                sectionsHtml.push(renderSection('Results', hits));
            }
        }
        return sectionsHtml.join('');
    }

    function renderSection(label, emojis, anchorCode) {
        const idAttr = anchorCode ? ` data-cat="${anchorCode}"` : '';
        const cells = emojis.map(e => `<button type="button" class="wep-cell" data-emoji="${e}" tabindex="-1">${e}</button>`).join('');
        return `<div class="wep-section"${idAttr}>
                  <span class="wep-section-label">${escapeHtml(label)}</span>
                  <div class="wep-grid">${cells}</div>
                </div>`;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function position(popup, anchor) {
        // Popup is position:fixed → coordinates are pure viewport-relative,
        // no scroll offsets needed.
        const rect = anchor.getBoundingClientRect();
        const w = popup.offsetWidth || 360;
        const h = popup.offsetHeight || 420;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        // Default: open ABOVE the anchor (chat composers live near the bottom).
        let top = rect.top - h - 8;
        let left = rect.left;
        // Flip to BELOW if not enough room above.
        if (top < 8) top = Math.min(rect.bottom + 8, vh - h - 8);
        // Clamp horizontally to the viewport.
        if (left + w > vw - 8) left = vw - w - 8;
        if (left < 8) left = 8;
        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
    }

    function close() {
        if (!_popup) return;
        _popup.remove();
        _popup = null;
        if (_outsideHandler) {
            document.removeEventListener('mousedown', _outsideHandler, true);
            _outsideHandler = null;
        }
        if (_escHandler) {
            document.removeEventListener('keydown', _escHandler, true);
            _escHandler = null;
        }
    }

    function open(anchor, onPick) {
        // Toggle behavior: clicking the same anchor closes the picker.
        if (_popup && _popup._anchor === anchor) {
            close();
            return;
        }
        close();   // close any previous picker on a different anchor

        const popup = document.createElement('div');
        popup.className = 'wep-popup';
        // Force fixed positioning + high z-index inline. Some host pages
        // have global CSS that wins over our `.wep-popup` rule and ends up
        // applying `position: relative` (we've seen this with the lightbox
        // on the same codebase). Inline beats any cascade.
        popup.style.cssText = 'position:fixed;z-index:1000001;';
        popup._anchor = anchor;
        popup.innerHTML = `
            <div class="wep-search-wrap">
              <svg class="wep-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" class="wep-search-input" placeholder="Search emoji" autocomplete="off">
            </div>
            <div class="wep-body"></div>
            <div class="wep-tabs">
              ${CATEGORIES.map(c => `<button type="button" class="wep-tab" data-cat="${c.code}" title="${c.label}">${c.icon}</button>`).join('')}
            </div>`;

        const body = popup.querySelector('.wep-body');
        const search = popup.querySelector('.wep-search-input');
        const tabs = popup.querySelectorAll('.wep-tab');

        function refresh(filterText) {
            body.innerHTML = buildBody(filterText);
        }
        refresh('');
        // Highlight first non-recent tab as active by default.
        const initialTab = (loadRecent().length > 0) ? 'r' : 'p';
        tabs.forEach(t => t.classList.toggle('is-active', t.dataset.cat === initialTab));

        // Search input
        search.addEventListener('input', () => refresh(search.value));

        // Click delegation: emoji cells + category tabs
        body.addEventListener('click', e => {
            const cell = e.target.closest('.wep-cell');
            if (!cell) return;
            const emoji = cell.dataset.emoji;
            saveRecent(emoji);
            try { onPick && onPick(emoji); } catch (err) { console.warn('[wep] onPick threw:', err); }
            // Don't close — WA Web keeps the picker open so users can chain picks.
        });
        popup.querySelector('.wep-tabs').addEventListener('click', e => {
            const tab = e.target.closest('.wep-tab');
            if (!tab) return;
            tabs.forEach(t => t.classList.toggle('is-active', t === tab));
            search.value = '';
            refresh('');
            // Scroll the matching section into view.
            const target = body.querySelector(`.wep-section[data-cat="${tab.dataset.cat}"]`)
                        || (tab.dataset.cat === 'r' ? body.firstElementChild : null);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        document.body.appendChild(popup);
        position(popup, anchor);
        _popup = popup;

        // Close on outside click (mousedown to beat focus-stealing).
        _outsideHandler = ev => {
            if (!_popup) return;
            if (popup.contains(ev.target)) return;
            if (anchor.contains(ev.target)) return;   // toggle handled in open()
            close();
        };
        document.addEventListener('mousedown', _outsideHandler, true);

        _escHandler = ev => { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', _escHandler, true);

        // Reposition on window resize.
        const onResize = () => { if (_popup) position(_popup, anchor); };
        window.addEventListener('resize', onResize, { passive: true });
        // Cleanup the resize listener when we close.
        const origClose = close;
        // (resize listener leaks one tick; harmless.)
    }

    window.WhatsappUI.EmojiPicker = { open, close };
})(window);
