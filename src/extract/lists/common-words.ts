// FR-18 and the name detectors: ordinary words that are often capitalised in titles, file names
// and sentence starts. A capitalised word on this list is never reported as a name.

const WORDS = `
a about above across after again against ago ahead all almost along already also although always am
among an and another any anyone anything anyway anywhere are around as ask asked at available away
back be because been before behind being below best better between beyond big both bring but by
call came can cannot could day days did different do does doing done down during each early either
else enough even ever every everyone everything example except far few first for found free from
full further get gets getting give given go going good got great had has have having he hello help
her here hers herself hey hi him himself his how however i if in including inside instead into is
it its itself just keep kind know known last later least less let like likely little long look
looking made main make makes making many may maybe me might mine more most much must my myself
near need needed needs never new next nice no none nor not nothing now of off often old on once one
only onto open or other others otherwise our ours ourselves out over own part per perhaps please
plus possible pretty quite rather really right same see seem seen several shall she should show
since so some someone something sometimes soon still such sure take than thank thanks that the
their theirs them themselves then there these they thing things this those though through thus to
today together too toward towards under unless until up upon us use used using very via want wanted
was way we well were what whatever when where whether which while who whole whom whose why will
with within without would yes yet you your yours yourself yourselves
january february march april may june july august september october november december
jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday
sunday mon tue wed thu fri sat sun week weekly month monthly year yearly annual daily hourly
dear regards best kind warm sincerely cheers team thank-you welcome hiring hire looking seeking
searching currently need needs required requirements require requires looking expert experts
experienced experience senior junior mid level lead principal entry intermediate professional
freelancer freelancers developer developers designer designers engineer engineers writer writers
editor editors manager managers assistant assistants specialist specialists consultant consultants
analyst analysts architect architects marketer marketers expert virtual va admin support agent
agents tester testers coach coaches tutor tutors translator translators illustrator illustrators
animator animators photographer photographers videographer producer creator creators founder ceo
cto cmo coo cfo vp director owner partner client clients customer customers user users people
project projects job jobs task tasks work works working contract contracts long short term
full-time part-time fulltime parttime ongoing one-time fixed hourly budget price rate rates cost
quote proposal proposals brief briefs spec specs specification specifications requirement
document documents doc docs file files folder sample samples example examples template templates
draft drafts final version versions v1 v2 v3 copy copies edit edited edits revision revisions
revised update updated updates new old latest current original backup scan scanned image images
photo photos picture pictures screenshot screenshots screen screens mockup mockups wireframe
wireframes prototype prototypes design designs logo logos brand branding banner banners flyer
flyers poster posters brochure brochures card cards icon icons illustration illustrations video
videos audio podcast animation graphic graphics ui ux web website websites site sites page pages
landing home homepage app apps application applications mobile ios android desktop software
platform platforms system systems tool tools dashboard dashboards portal portals store stores
shop shops ecommerce e-commerce marketplace product products service services feature features
data database databases api apis backend frontend front-end back-end fullstack full-stack stack
server servers cloud hosting domain domains email emails newsletter content article articles blog
blogs post posts copywriting seo sem smm social media marketing ads ad campaign campaigns sales
lead leads funnel funnels crm erp report reports reporting analysis analytics research survey
spreadsheet spreadsheets sheet sheets excel word powerpoint pdf presentation presentation slides
deck decks invoice invoices receipt receipts contract agreement nda sow rfp rfq faq terms policy
policies plan plans planning strategy strategies schedule timeline roadmap budget estimate
estimates task list lists notes note overview summary details detail info information
instructions guide guidelines manual readme intro introduction description descriptions
questions question answer answers form forms test tests testing qa review reviews feedback
help support fix fixes bug bugs issue issues error errors problem problems change changes
improvement improvements integration integrations migration setup install installation
configuration automation automate script scripts bot bots ai ml llm gpt chatgpt model models
python javascript typescript java php ruby rust golang go swift kotlin flutter react angular vue
node nodejs next nextjs nuxt svelte django flask laravel rails wordpress shopify wix webflow
bubble figma sketch photoshop illustrator canva html css sql nosql mongodb mysql postgres
postgresql aws azure gcp docker kubernetes linux windows mac ios unity unreal blender
english spanish french german italian portuguese russian chinese arabic hindi japanese korean
dutch polish turkish native fluent writing speaking translation transcription voice voiceover
over subtitles captions caption
great excellent amazing awesome fantastic wonderful perfect fast quick quickly easy simple clean
modern professional creative friendly responsive reliable responsible communication communicative
skilled talented highly strongly recommend recommended pleasure job done again definitely
absolutely truly very well happy pleased satisfied delighted glad hope hopefully looking forward
exactly timely delivered delivery quality detail attention patient helpful knowledgeable
thorough honest clear clearly understanding understood instructions deadline deadlines budget
time times hours hour minutes minute weeks months years
yes no ok okay true false high low medium small large huge tiny top bottom left right center
north south east west global local international national remote onsite hybrid usa us uk eu
america american europe european asia asian africa african australia australian canada canadian
india indian
image img pic doc pdf xls xlsx ppt pptx docx jpg jpeg png gif svg mp4 mov zip rar txt csv json
final2 final_final copy_of untitled dsc dcim wa whatsapp pxl
create build develop design write make set start launch register form open run manage buy sell
hire find add fix convert migrate integrate connect move transfer send share upload download
review check verify complete finish deliver provide offer prepare research analyze analyse
optimize optimise improve redesign rebuild refactor maintain support translate transcribe edit
proofread format clean scrape extract import export generate produce record shoot film draw
paint sketch animate model render code program test deploy host install configure setup
apply submit attach include explain describe tell contact reach visit join follow learn read
catalogue catalog catalogues catalogs guide handbook menu menus pricelist pricing price prices
portfolio resume cv letter letterhead profile pitch onboarding checklist workflow flowchart
diagram chart charts table tables map maps plan floorplan layout layouts storyboard script
outline transcript proof proofs artwork assets asset media kit styleguide style colors colours
palette font fonts typography reference references inspiration moodboard mood board
`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));

export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase().replace(/[’']s$/, ''));
}
