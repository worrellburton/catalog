-- Gender backfill automation
--
-- Adds a Postgres-side first-name → gender inference function (mirrors
-- app/services/genders.ts) plus a backfill procedure scheduled via
-- pg_cron to run daily at 06:00 UTC. Sign-up time inference already
-- runs client-side in services/auth.ts:198-204 (every getCurrentUser
-- after SIGNED_IN); this migration covers the remaining gap — users
-- who signed up before that wiring landed, or whose first name wasn't
-- in the corpus at the time and is now reachable.

-- ── Inference function ──────────────────────────────────────────────────────

create or replace function public.infer_gender_from_name(p_full_name text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_first text;
  v_male  constant text[] := array[
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
    'worrell','samir','garrett','bobby'
  ];
  v_female constant text[] := array[
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
    'rachael','racheal','rachel','raquel','rebecca','regina','renee','reta','rhea','rhoda','rhonda','rita','roberta','rochelle','rosa','rosalie','rosalind','rosanne','rose','rosella','rosemary','roxanne','ruby','ruth',
    'sabrina','sadie','sally','samantha','sandra','sara','sarah','sasha','savannah','scarlett','selena','selma','serena','shannon','shari','sharon','shawna','sheila','shelby','shelia','shelly','sheri','sherri','sherry','sheryl','shirley','sienna','sierra','silvia','simone','sky','skylar','sloane','sofia','sondra','sonia','sonja','sonya','sophia','sophie','stacey','stacie','stacy','stella','stephanie','sue','susan','susie','suzanne','suzette','sybil','sydney','sylvia',
    'tabatha','tabitha','tamara','tamela','tameka','tami','tammy','tania','tanya','tara','tasha','tatiana','teresa','terri','tessa','thelma','theresa','tiffany','tina','tisha','toni','tonia','tonya','tracee','tracey','tracie','trinity','trisha','trista','tyra',
    'ursula',
    'val','valarie','valencia','valerie','vanessa','velma','venessa','vera','vernita','veronica','vicki','vickie','vicky','victoria','vida','viola','violet','virginia','vivian','viviana',
    'wanda','wendy','whitney','willa','willie','wilma','willow','winifred','winona','wren',
    'xiomara','xochitl',
    'yadira','yasmin','yasmine','yesenia','yolanda','yvette','yvonne',
    'zelda','zella','zenobia','zoe','zoey','zora'
  ];
begin
  if p_full_name is null then return 'unknown'; end if;
  -- First whitespace-separated token, lowercased, letters only.
  v_first := regexp_replace(lower(split_part(trim(p_full_name), ' ', 1)), '[^a-z]', '', 'g');
  if v_first = '' then return 'unknown'; end if;
  if v_first = any(v_male)   then return 'male';   end if;
  if v_first = any(v_female) then return 'female'; end if;
  return 'unknown';
end;
$$;

-- ── Backfill procedure ──────────────────────────────────────────────────────

create or replace function public.backfill_user_genders()
returns table(scanned int, updated int, skipped int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scanned int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  r record;
  v_inferred text;
begin
  for r in
    select id, full_name, gender
    from public.profiles
    where (gender is null or gender = 'unknown')
      and full_name is not null
      and full_name <> ''
  loop
    v_scanned := v_scanned + 1;
    v_inferred := public.infer_gender_from_name(r.full_name);
    if v_inferred = 'unknown' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update public.profiles set gender = v_inferred where id = r.id;
    v_updated := v_updated + 1;
  end loop;
  return query select v_scanned, v_updated, v_skipped;
end;
$$;

-- Service-role can call the backfill; everyone else cannot.
revoke all on function public.backfill_user_genders() from public;
grant execute on function public.backfill_user_genders() to service_role;

-- ── pg_cron schedule ────────────────────────────────────────────────────────
-- Daily at 06:00 UTC. Idempotent — unschedules a stale job with the same
-- name first so this migration can be re-applied without duplicating.

do $$
begin
  perform cron.unschedule('backfill_user_genders_daily')
  where exists (
    select 1 from cron.job where jobname = 'backfill_user_genders_daily'
  );
exception when others then
  -- cron.unschedule errors when no job exists; ignore.
  null;
end;
$$;

select cron.schedule(
  'backfill_user_genders_daily',
  '0 6 * * *',
  $$select public.backfill_user_genders();$$
);

-- One-shot: run it now so the existing rows surfaced in the screenshot
-- (Amir, Dev 0002, Taylor, …) get their gender filled in immediately
-- rather than waiting until 06:00 UTC tomorrow.
select public.backfill_user_genders();