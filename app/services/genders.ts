import { supabase } from '~/utils/supabase';

/**
 * Curated first-name corpus -- the 300-ish most common male / female
 * first names with common nicknames. Lookup is on the FIRST whitespace-
 * separated token of full_name, lowercased. Names that read as either
 * (Jordan, Taylor, Riley, Morgan, Casey, Avery, Robin) are intentionally
 * left out so they fall through to 'unknown' rather than guessing wrong.
 */
const MALE_NAMES = new Set([
  'aaron','adam','adrian','aiden','alan','albert','alex','alexander','alfred','alvin','andre','andrew','andy','angel','anthony','antoine','antonio','arnold','arthur','arturo','austin',
  'barry','ben','benjamin','bernard','bert','bill','billy','blake','bob','bobby','brad','bradley','brandon','brendan','brent','brett','brian','bruce','bryan','bryce','byron',
  'caleb','cameron','carl','carlos','cary','charles','charlie','chase','chester','chris','christian','christopher','clarence','clay','clayton','clifton','clinton','clyde','cole','colin','connor','conrad','cooper','cory','craig','curt','curtis',
  'dale','damian','damon','dan','daniel','danny','darin','darius','darnell','daron','darrell','darren','darryl','dave','david','dean','dennis','derek','derrick','desmond','devin','dexter','dick','diego','don','donald','donny','douglas','doug','drew','duane','duncan','dustin','dwayne','dwight','dylan',
  'earl','ed','eddie','edgar','edmund','edward','edwin','elbert','eli','elijah','ellis','elmer','elton','emanuel','emil','emilio','enrique','eric','erik','ernest','ernie','ethan','eugene','evan','everett','ezra',
  'felix','fernando','floyd','francisco','francis','frank','frankie','franklin','fred','freddie','frederick',
  'gabriel','garrett','gary','gene','geoffrey','george','gerald','gerardo','gilbert','glen','glenn','gordon','grady','graham','grant','greg','gregory','guillermo','gustavo','gus','guy',
  'hank','harold','harry','harvey','hector','henry','herbert','herman','homer','horace','howard','hubert','hugh','hugo','hunter',
  'ian','irving','isaac','isaiah','ivan',
  'jack','jackson','jacob','jaime','jake','james','jamie','jared','jason','javier','jay','jed','jeff','jeffery','jeffrey','jeremiah','jeremy','jerome','jerry','jesse','jesus','jim','jimmie','jimmy','joaquin','joe','joel','john','johnnie','johnny','jon','jonathan','jorge','jose','joseph','josh','joshua','juan','julian','julio','justin',
  'karl','keith','kelvin','ken','kenneth','kenny','kent','kevin','kirk','kris','kurt','kyle',
  'lamar','lance','larry','laurence','lawrence','lee','leon','leonard','leonardo','leroy','leslie','lester','levi','lewis','liam','lincoln','lloyd','logan','lonnie','louis','lucas','lucio','luis','luke','lyle',
  'malcolm','manuel','marc','marco','marcos','marcus','mario','marion','mark','marlon','martin','marty','marvin','mason','mateo','matt','matthew','maurice','max','maxwell','melvin','michael','mickey','miguel','mike','miles','milton','mitchell','morris','muhammad','myron',
  'nate','nathan','nathaniel','neal','ned','neil','nelson','nicholas','nick','nicolas','noah','noel','nolan','norman',
  'oliver','omar','orlando','oscar','otis','owen',
  'pablo','patrick','paul','pedro','percy','perry','peter','phil','philip','phillip','pierre','preston',
  'quentin','quincy','quinton',
  'rafael','ralph','ramon','randall','randy','raul','ray','raymond','reed','reggie','reginald','rene','rex','ricardo','rich','richard','rick','rickey','ricky','riley','rob','robbie','robert','roberto','rodney','rodolfo','roger','roland','rolando','ron','ronald','ronnie','rory','ross','roy','ruben','rudolph','rudy','russell','ryan',
  'salvador','sam','samuel','santiago','saul','scott','sean','sebastian','seth','shane','shaun','shawn','sheldon','sherman','sidney','simon','spencer','stan','stanley','stephen','steve','steven','stewart','stuart',
  'ted','terrance','terrell','terrence','terry','theodore','theo','thomas','tim','timmy','timothy','tobias','todd','tom','tommy','tony','tracy','travis','trent','trevor','tristan','troy','tyler','tyrone','tyson',
  'ulysses',
  'vance','vernon','vicente','victor','vince','vincent','virgil',
  'wade','wallace','walter','warren','wayne','wendell','wesley','wes','wilbur','wiley','william','willie','willis','wilson','winston','wyatt',
  'xander','xavier',
  'yusuf',
  'zachary','zachery','zack','zane','zion',
  // Brand-side nicknames + uncommon first names worth catching.
  'worrell','samir','garrett','bobby',
]);

const FEMALE_NAMES = new Set([
  'aaliyah','abby','abigail','adelaide','adriana','adrienne','agnes','aimee','alana','alessandra','alex','alexa','alexandra','alexandria','alexis','alice','alicia','alison','allison','alma','alyssa','amanda','amber','amelia','amy','ana','andrea','angel','angela','angelica','angelina','angie','anita','ann','anna','annabelle','anne','annette','annie','antoinette','april','aria','ariana','arianna','arielle','arlene','ashlee','ashley','aubrey','audrey','aurora','autumn','ava','avery',
  'barbara','beatrice','becky','belinda','bella','bernice','bertha','beth','bethany','betty','beulah','beverly','billie','blanche','bonnie','brandi','brenda','briana','brianna','bridget','britney','brittany','brooke',
  'camila','camille','candice','cara','carla','carmen','carol','caroline','carolyn','carrie','casey','cassandra','catherine','cathy','celeste','celia','charity','charlene','charlotte','chastity','chelsea','cheryl','chloe','christa','christian','christina','christine','cindy','claire','clara','clarissa','claudia','colleen','connie','constance','consuelo','cora','corina','courtney','crystal','cynthia',
  'daisy','dana','danielle','daphne','darlene','dawn','deanna','deborah','debbie','debra','delia','denise','desiree','destiny','diana','diane','dianne','dolores','donna','dora','doris','dorothy',
  'eda','edith','edna','edwina','effie','eileen','elaine','eleanor','elena','elise','eliza','elizabeth','ella','ellen','ellie','eloise','elsa','elsie','elva','elvira','emilia','emily','emma','erica','erika','erin','esmeralda','esperanza','essie','estelle','esther','ethel','etta','eugenia','eunice','eva','evangelina','evelyn',
  'faith','felicia','felicity','fern','fiona','flora','florence','frances','francesca','frankie','freda',
  'gabriela','gabrielle','gail','gemma','genesis','geneva','genevieve','georgia','geraldine','gertrude','gianna','gina','gladys','glenda','gloria','grace','greta','gretchen','guadalupe','gwen','gwendolyn',
  'hailey','hannah','harper','harriet','hattie','hazel','heather','heidi','helen','helena','henrietta','hilda','holly','hope',
  'ida','imani','imogen','ingrid','irene','iris','isabel','isabella','isabelle','iva','ivy',
  'jackie','jacqueline','jada','jade','jamie','jan','jane','janet','janice','janie','janine','jasmine','jean','jeanette','jeanne','jeannette','jeannie','jenna','jennie','jennifer','jenny','jeri','jessica','jewel','jill','jillian','jo','joan','joann','joanna','joanne','jocelyn','jodi','jodie','jody','joelle','josefina','josephine','josie','joy','joyce','juanita','judith','judy','julia','juliana','julie','juliet','june','justine',
  'kaitlyn','kara','karen','kari','karla','kate','katelyn','katherine','katheryn','kathleen','kathryn','kathy','katie','katrina','kay','kayla','kaylee','keisha','kelly','kelsey','kendall','kendra','kennedy','kerry','kim','kimberly','kira','kirsten','krista','kristen','kristi','kristin','kristina','kristine','kristy','krystal',
  'lacey','lakeisha','lana','lara','latanya','latasha','latoya','laura','laurel','lauren','laurie','layla','leah','leann','leanne','lee','leila','lena','lenora','leona','leslie','lila','lillian','lilly','lily','linda','lindsay','lindsey','lisa','liza','lola','lora','loretta','lori','lorraine','lottie','louise','luann','lucia','lucille','lucinda','lucretia','lucy','luella','luna','luz','lydia','lynda','lynette','lynn','lynne',
  'mabel','madeline','madeleine','madison','mae','maggie','maite','mallory','mara','marcella','marcia','margaret','margarita','margie','marguerite','maria','mariah','marian','marianne','marie','marilyn','marina','marion','marisa','marisol','marissa','marjorie','marlene','marsha','martha','marti','martina','marty','marva','mary','maryann','maryanne','marylou','matilda','mattie','maureen','mavis','maxine','maya','meaghan','megan','meghan','melanie','melba','melinda','melissa','mellie','melody','mercedes','meredith','meta','mia','michele','michelle','mila','mildred','millicent','millie','mimi','minerva','minnie','miranda','miriam','missy','misty','mitzi','molly','mona','monica','monique','muriel','myra','myrna','myrtle',
  'nadia','nadine','nan','nancy','nanette','naomi','natalia','natalie','natasha','nellie','nelda','nettie','nicole','nikki','nina','nita','nora','noreen','norma',
  'octavia','odelia','odell','olga','olive','olivia','opal','ophelia','ora','oralia',
  'page','paige','pamela','patrice','patricia','patsy','patti','patty','paula','paulette','pauline','peggy','penelope','penny','phoebe','phyllis','polly','priscilla',
  'queen','queenie',
  'rachael','rachel','raquel','rebecca','regina','renee','reta','rhea','rhoda','rhonda','rita','roberta','rochelle','rosa','rosalie','rosalind','rosanne','rose','rosella','rosemary','roxanne','ruby','ruth',
  'sabrina','sadie','sally','samantha','sandra','sara','sarah','sasha','savannah','scarlett','selena','selma','serena','shannon','shari','sharon','shawna','sheila','shelby','shelia','shelly','sheri','sherri','sherry','sheryl','shirley','sienna','sierra','silvia','simone','sky','skylar','sloane','sofia','sondra','sonia','sonja','sonya','sophia','sophie','stacey','stacie','stacy','stella','stephanie','sue','susan','susie','suzanne','suzette','sybil','sydney','sylvia',
  'tabatha','tabitha','tamara','tamela','tameka','tamela','tami','tammy','tania','tanya','tara','tasha','tatiana','teresa','terri','tessa','thelma','theresa','tiffany','tina','tisha','toni','tonia','tonya','tracee','tracey','tracie','trinity','trisha','trista','tyra',
  'ursula',
  'val','valarie','valencia','valerie','vanessa','velma','venessa','vera','vernita','veronica','vicki','vickie','vicky','victoria','vida','viola','violet','virginia','vivian','viviana',
  'wanda','wendy','whitney','willa','willie','wilma','willow','winifred','winona','wren',
  'xiomara','xochitl',
  'yadira','yasmin','yasmine','yesenia','yolanda','yvette','yvonne',
  'zelda','zella','zenobia','zoe','zoey','zora',
]);

export type UserGender = 'male' | 'female' | 'unknown';
export type ProductGender = 'male' | 'female' | 'unisex' | null;

/**
 * Pick a gender from a person's full name. Looks at the first
 * whitespace-separated token (the first name), normalized to
 * lowercase letters only. Returns 'unknown' rather than guessing on
 * names that aren't in either set.
 */
export function inferUserGenderFromName(fullName: string | null | undefined): UserGender {
  if (!fullName) return 'unknown';
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  if (!first) return 'unknown';
  if (MALE_NAMES.has(first)) return 'male';
  if (FEMALE_NAMES.has(first)) return 'female';
  return 'unknown';
}

const PRODUCT_FEMALE_PATTERNS: RegExp[] = [
  /\bwomen'?s?\b/i,
  /\bwoman'?s?\b/i,
  /\bladies'?\b/i,
  /\bladys?\b/i,
  /\bgirls'?\b/i,
  /\bfemale\b/i,
  /\bfor\s*women\b/i,
  /\bfor\s*her\b/i,
  /\bmiss\b/i,
  /\bmaternity\b/i,
];

const PRODUCT_MALE_PATTERNS: RegExp[] = [
  /\bmen'?s?\b/i,
  /\bmens\b/i,
  /\bgentlemen'?s?\b/i,
  /\bman'?s?\b/i,
  /\bboys'?\b/i,
  /\bmasculine\b/i,
  /\bfor\s*men\b/i,
  /\bfor\s*him\b/i,
  /\bmale\b/i,
  /\bguys'?\b/i,
];

const PRODUCT_UNISEX_PATTERNS: RegExp[] = [
  /\bunisex\b/i,
  /\bgender[-\s]*neutral\b/i,
  /\bnon[-\s]*binary\b/i,
];

/**
 * Pick a gender from a product name. Returns null when no signal is
 * present so callers can decide whether to leave the row alone or
 * fall back to a default.
 */
export function inferProductGenderFromName(name: string | null | undefined): ProductGender {
  if (!name) return null;
  if (PRODUCT_UNISEX_PATTERNS.some(rx => rx.test(name))) return 'unisex';
  const isFemale = PRODUCT_FEMALE_PATTERNS.some(rx => rx.test(name));
  const isMale = PRODUCT_MALE_PATTERNS.some(rx => rx.test(name));
  if (isFemale && isMale) return 'unisex';
  if (isFemale) return 'female';
  if (isMale) return 'male';
  return null;
}

export interface AuditCounts {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}

export async function auditAllUserGenders(): Promise<AuditCounts> {
  const result: AuditCounts = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  if (!supabase) return result;
  const { data } = await supabase.from('profiles').select('id, full_name, gender');
  for (const row of data || []) {
    result.scanned++;
    const inferred = inferUserGenderFromName(row.full_name);
    if (inferred === 'unknown') { result.skipped++; continue; }
    if (row.gender === inferred) { result.skipped++; continue; }
    const { error } = await supabase
      .from('profiles')
      .update({ gender: inferred })
      .eq('id', row.id);
    if (error) result.errors++;
    else result.updated++;
  }
  return result;
}

export async function auditAllProductGenders(): Promise<AuditCounts> {
  const result: AuditCounts = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  if (!supabase) return result;
  const { data } = await supabase.from('products').select('id, name, gender');
  for (const row of data || []) {
    result.scanned++;
    const inferred = inferProductGenderFromName(row.name);
    if (inferred === null) { result.skipped++; continue; }
    if (row.gender === inferred) { result.skipped++; continue; }
    const { error } = await supabase
      .from('products')
      .update({ gender: inferred })
      .eq('id', row.id);
    if (error) result.errors++;
    else result.updated++;
  }
  return result;
}

/** Direct gender override from the admin UI. */
export async function updateUserGender(
  userId: string,
  gender: UserGender,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('profiles')
    .update({ gender })
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

/** Lookup the current shopper's gender; defaults to 'unknown'. */
export async function getUserGender(userId: string): Promise<UserGender> {
  if (!supabase) return 'unknown';
  const { data } = await supabase
    .from('profiles')
    .select('gender')
    .eq('id', userId)
    .maybeSingle();
  const g = data?.gender as UserGender | undefined;
  return g === 'male' || g === 'female' ? g : 'unknown';
}
