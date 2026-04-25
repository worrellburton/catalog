-- Auto-set profiles.gender at signup time.
--
-- The client-side inference in services/auth.ts only fires for the
-- currently signed-in user, so creators (or anyone who signs up but
-- doesn't immediately load the consumer app) stay gender='unknown'
-- forever. Mirror the JS name corpus into a SQL function and call it
-- from handle_auth_user_change so every new profile gets a gender on
-- INSERT, then backfill rows that are still unknown.

create or replace function public.infer_user_gender_from_name(name_input text)
returns text
language plpgsql
immutable
as $$
declare
  first_token text;
begin
  first_token := regexp_replace(lower(split_part(coalesce(name_input, ''), ' ', 1)), '[^a-z]', '', 'g');
  if first_token = '' then return 'unknown'; end if;

  if first_token = ANY(ARRAY[
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
    'worrell','samir'
  ]) then
    return 'male';
  end if;

  if first_token = ANY(ARRAY[
    'aaliyah','abby','abigail','adelaide','adriana','adrienne','agnes','aimee','alana','alessandra','alexa','alexandra','alexandria','alexis','alice','alicia','alison','allison','alma','alyssa','amanda','amber','amelia','amy','ana','andrea','angela','angelica','angelina','angie','anita','ann','anna','annabelle','anne','annette','annie','antoinette','april','aria','ariana','arianna','arielle','arlene','ashlee','ashley','aubrey','audrey','aurora','autumn','ava','avery',
    'barbara','beatrice','becky','belinda','bella','bernice','bertha','beth','bethany','betty','beulah','beverly','billie','blanche','bonnie','brandi','brenda','briana','brianna','bridget','britney','brittany','brooke',
    'camila','camille','candice','cara','carla','carmen','carol','caroline','carolyn','carrie','casey','cassandra','catherine','cathy','celeste','celia','charity','charlene','charlotte','chastity','chelsea','cheryl','chloe','christa','christina','christine','cindy','claire','clara','clarissa','claudia','colleen','connie','constance','consuelo','cora','corina','courtney','crystal','cynthia',
    'daisy','dana','danielle','daphne','darlene','dawn','deanna','deborah','debbie','debra','delia','denise','desiree','destiny','diana','diane','dianne','dolores','donna','dora','doris','dorothy',
    'eda','edith','edna','edwina','effie','eileen','elaine','eleanor','elena','elise','eliza','elizabeth','ella','ellen','ellie','eloise','elsa','elsie','elva','elvira','emilia','emily','emma','erica','erika','erin','esmeralda','esperanza','essie','estelle','esther','ethel','etta','eugenia','eunice','eva','evangelina','evelyn',
    'faith','felicia','felicity','fern','fiona','flora','florence','frances','francesca','freda',
    'gabriela','gabrielle','gail','gemma','genesis','geneva','genevieve','georgia','geraldine','gertrude','gianna','gina','gladys','glenda','gloria','grace','greta','gretchen','guadalupe','gwen','gwendolyn',
    'hailey','hannah','harper','harriet','hattie','hazel','heather','heidi','helen','helena','henrietta','hilda','holly','hope',
    'ida','imani','imogen','ingrid','irene','iris','isabel','isabella','isabelle','iva','ivy',
    'jackie','jacqueline','jada','jade','jan','jane','janet','janice','janie','janine','jasmine','jean','jeanette','jeanne','jeannette','jeannie','jenna','jennie','jennifer','jenny','jeri','jessica','jewel','jill','jillian','jo','joan','joann','joanna','joanne','jocelyn','jodi','jodie','jody','joelle','josefina','josephine','josie','joy','joyce','juanita','judith','judy','julia','juliana','julie','juliet','june','justine',
    'kaitlyn','kara','karen','kari','karla','kate','katelyn','katherine','katheryn','kathleen','kathryn','kathy','katie','katrina','kay','kayla','kaylee','keisha','kelly','kelsey','kendall','kendra','kennedy','kerry','kim','kimberly','kira','kirsten','krista','kristen','kristi','kristin','kristina','kristine','kristy','krystal',
    'lacey','lakeisha','lana','lara','latanya','latasha','latoya','laura','laurel','lauren','laurie','layla','leah','leann','leanne','leila','lena','lenora','leona','lila','lillian','lilly','lily','linda','lindsay','lindsey','lisa','liza','lola','lora','loretta','lori','lorraine','lottie','louise','luann','lucia','lucille','lucinda','lucretia','lucy','luella','luna','luz','lydia','lynda','lynette','lynn','lynne',
    'mabel','madeline','madeleine','madison','mae','maggie','maite','mallory','mara','marcella','marcia','margaret','margarita','margie','marguerite','maria','mariah','marian','marianne','marie','marilyn','marina','marisa','marisol','marissa','marjorie','marlene','marsha','martha','marti','martina','marva','mary','maryann','maryanne','marylou','matilda','mattie','maureen','mavis','maxine','maya','meaghan','megan','meghan','melanie','melba','melinda','melissa','mellie','melody','mercedes','meredith','meta','mia','michele','michelle','mila','mildred','millicent','millie','mimi','minerva','minnie','miranda','miriam','missy','misty','mitzi','molly','mona','monica','monique','muriel','myra','myrna','myrtle',
    'nadia','nadine','nan','nancy','nanette','naomi','natalia','natalie','natasha','nellie','nelda','nettie','nicole','nikki','nina','nita','nora','noreen','norma',
    'octavia','odelia','odell','olga','olive','olivia','opal','ophelia','ora','oralia',
    'page','paige','pamela','patrice','patricia','patsy','patti','patty','paula','paulette','pauline','peggy','penelope','penny','phoebe','phyllis','polly','priscilla',
    'queen','queenie',
    'rachael','racheal','rachel','raquel','rebecca','regina','renee','reta','rhea','rhoda','rhonda','rita','roberta','rochelle','rosa','rosalie','rosalind','rosanne','rose','rosella','rosemary','roxanne','ruby','ruth',
    'sabrina','sadie','sally','samantha','sandra','sara','sarah','sasha','savannah','scarlett','selena','selma','serena','shannon','shari','sharon','shawna','sheila','shelby','shelia','shelly','sheri','sherri','sherry','sheryl','shirley','sienna','sierra','silvia','simone','sky','skylar','sloane','sofia','sondra','sonia','sonja','sonya','sophia','sophie','stacey','stacie','stacy','stella','stephanie','sue','susan','susie','suzanne','suzette','sybil','sydney','sylvia',
    'tabatha','tabitha','tamara','tamela','tameka','tami','tammy','tania','tanya','tara','tasha','tatiana','teresa','terri','tessa','thelma','theresa','tiffany','tina','tisha','toni','tonia','tonya','tracee','tracey','tracie','trinity','trisha','trista','tyra',
    'ursula',
    'val','valarie','valencia','valerie','vanessa','velma','venessa','vera','vernita','veronica','vicki','vickie','vicky','victoria','vida','viola','violet','virginia','vivian','viviana',
    'wanda','wendy','whitney','willa','wilma','willow','winifred','winona','wren',
    'xiomara','xochitl',
    'yadira','yasmin','yasmine','yesenia','yolanda','yvette','yvonne',
    'zelda','zella','zenobia','zoe','zoey','zora'
  ]) then
    return 'female';
  end if;

  return 'unknown';
end;
$$;

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_full_name text;
begin
  v_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    new.email
  );
  insert into public.profiles (id, email, full_name, avatar_url, provider, gender, created_at, last_sign_in_at)
  values (
    new.id,
    new.email,
    v_full_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    public.infer_user_gender_from_name(v_full_name),
    new.created_at,
    new.last_sign_in_at
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    provider = excluded.provider,
    last_sign_in_at = excluded.last_sign_in_at,
    gender = case
      when public.profiles.gender is null or public.profiles.gender = 'unknown'
        then public.infer_user_gender_from_name(excluded.full_name)
      else public.profiles.gender
    end;
  return new;
end;
$$;

update public.profiles
   set gender = public.infer_user_gender_from_name(full_name)
 where (gender is null or gender = 'unknown')
   and full_name is not null
   and public.infer_user_gender_from_name(full_name) <> 'unknown';
