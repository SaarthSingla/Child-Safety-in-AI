import type { AgeRequirement } from '@/verifier/types';

export type ContentRating = 'everyone' | '12+' | '18+';

export type Article = {
  id: string;
  title: string;
  category: string;
  rating: ContentRating;
  readMinutes: number;
  // Safe to show before any age check.
  summary: string;
  // Only rendered once access has been decided. (In a real service a
  // restricted body would be fetched from a server only after authorization;
  // this demo ships it in the app bundle.)
  body: string[];
  accent: string;
};

// Sample articles for demonstration only.
export const CATALOG: Article[] = [
  {
    id: 'how-bees-build-a-hive',
    title: 'How Bees Build a Hive Without a Blueprint',
    category: 'Nature',
    rating: 'everyone',
    readMinutes: 4,
    summary:
      'Tens of thousands of bees, no plans, and yet every hive is a masterclass in geometry.',
    accent: '#2F9E60',
    body: [
      'At the height of summer a honeybee colony can hold up to 60,000 bees, and not one of them has read a building manual. Yet the honeycomb they make is one of the most efficient structures in nature.',
      'Young worker bees produce tiny flakes of wax from glands on their abdomens. They chew the wax until it turns soft, then shape it into small six-sided cells, packed side by side.',
      'Why six sides? Hexagons fit together with no gaps and use less wax than squares or triangles to hold the same amount of honey. Mathematicians only proved this "honeycomb conjecture" in 1999, long after the bees had it figured out.',
      'The comb stores honey and pollen, and it is also the nursery for the next generation. The colony keeps the nursery at a steady 35°C: in cold weather the bees shiver their flight muscles to make heat, and in summer they line up and fan their wings to cool the hive down.',
    ],
  },
  {
    id: 'your-first-loop',
    title: 'Coding for Beginners: Your First Loop',
    category: 'Technology',
    rating: 'everyone',
    readMinutes: 5,
    summary:
      'Computers are brilliant at boring, repetitive jobs. Loops are how you hand those jobs over.',
    accent: '#2563EB',
    body: [
      'Imagine you had to write "Well done!" on 100 certificates. You could do it by hand, or you could tell a computer to do it for you. The trick that makes this possible is called a loop.',
      'A loop is a set of instructions that repeats. In plain English: for each name in the list, write the name on a certificate and add the words "Well done!". The computer follows those steps once per name, without getting bored or making typos.',
      'Every loop needs three things: something to loop over (a list of names, a range of numbers), the steps to repeat, and a way to know when to stop. Forget the last one and you get an "infinite loop", where the program never finishes.',
      'Try it yourself: write down the steps to make a sandwich, then decide which of them you would repeat for ten sandwiches. You have just found your first loop.',
    ],
  },
  {
    id: 'why-the-sky-is-blue',
    title: 'Why the Sky Is Blue (and Sunsets Are Red)',
    category: 'Science',
    rating: 'everyone',
    readMinutes: 3,
    summary:
      'Sunlight looks white, but it is really a mixture of colours, and the air treats them differently.',
    accent: '#0EA5E9',
    body: [
      'Sunlight looks white, but it is a mixture of every colour of the rainbow. Each colour travels as a wave, and blue light has a shorter wavelength than red.',
      'When sunlight enters the atmosphere it bumps into gas molecules. Short blue waves are scattered far more strongly than long red ones, so blue light gets bounced all over the sky and reaches your eyes from every direction. This is called Rayleigh scattering.',
      'At sunrise and sunset the light has to cross much more air to reach you. Most of the blue is scattered away along the way, leaving the reds and oranges to colour the horizon.',
    ],
  },
  {
    id: 'sleep-screens-teen-brain',
    title: 'Sleep, Screens and the Teenage Brain',
    category: 'Health',
    rating: '12+',
    readMinutes: 5,
    summary:
      'Why late nights come naturally in your teens, and what actually helps you sleep better.',
    accent: '#7C3AED',
    body: [
      'Health guidelines suggest teenagers need roughly 8 to 10 hours of sleep a night. Most get far less, and it is not simply laziness.',
      'During adolescence the body clock shifts later. Melatonin, the hormone that makes you sleepy, is released later in the evening, so feeling wide awake at 11pm is biology, not just habit.',
      'Screens make it harder. Bright light in the evening tells the brain it is still daytime, and notifications, videos and group chats keep it switched on well after you meant to stop.',
      'Small changes help more than dramatic ones. Charge your phone outside the bedroom, dim the lights an hour before bed, keep a similar wake-up time at weekends, and go easy on caffeine after lunch.',
    ],
  },
  {
    id: 'spotting-cyberbullying',
    title: 'Cyberbullying: How to Spot It and What to Do',
    category: 'Society',
    rating: '12+',
    readMinutes: 5,
    summary:
      'Mean comments, group chats and fake accounts: recognising online bullying, and how to respond.',
    accent: '#DB2777',
    body: [
      'Cyberbullying is when someone uses phones, games or social media to repeatedly hurt, embarrass or threaten another person. It can be public, like nasty comments, or private, like being left out of a group chat on purpose.',
      'It can feel harder to escape than bullying in person because it follows you home. It can also spread quickly and is easy to do anonymously.',
      'If it happens to you: try not to retaliate, save screenshots as evidence, block and report the account, and tell someone you trust, such as a parent, teacher or school counsellor. Reporting is not "snitching".',
      'If you see it happening to someone else, you can help without confronting anyone. Message the person privately to check they are okay, do not share or like the hurtful post, and report it.',
    ],
  },
  {
    id: 'first-part-time-job',
    title: 'Your First Part-Time Job: What to Know Before You Start',
    category: 'Life skills',
    rating: '12+',
    readMinutes: 4,
    summary:
      'Rules, rights and money basics to check before you take a first job.',
    accent: '#D97706',
    body: [
      'A first job teaches more than how to earn money. It builds reliability, teamwork and confidence, and it looks good later on applications.',
      'The rules on how young you can start, how many hours you can work and which jobs are allowed differ from country to country, and often from region to region. Check your local government guidance before you accept anything.',
      'Ask about the basics up front: your pay rate, your hours, who your manager is, and what training you will get. You have the right to a safe workplace, and you should never be asked to do something that feels unsafe.',
      'Decide what you will do with the money before the first payday. Even saving a fixed share each week, before you spend anything, turns a small wage into a real habit.',
    ],
  },
  {
    id: 'life-under-siege',
    title: 'Life Under Siege: The Human Cost of Modern War',
    category: 'World',
    rating: '18+',
    readMinutes: 8,
    summary:
      'A sobering look at what prolonged armed conflict does to the civilians who live through it. Mature themes.',
    accent: '#B91C1C',
    body: [
      'Modern wars are fought as much in neighbourhoods as on battlefields. When fighting reaches towns and cities, the people who bear the heaviest burden are usually civilians: families who lose their homes, workers who lose their income, and children whose schooling stops for months or years.',
      'Displacement is often the first great cost. People leave with what they can carry, cross borders or shelter in overcrowded buildings, and depend on aid convoys for food, water and medicine. Every route out becomes a negotiation with danger.',
      'Health systems come under enormous strain. Hospitals face shortages of power, supplies and staff at the very moment the need is greatest, and medical workers are among those who put themselves at risk to keep going. International humanitarian law, including the Geneva Conventions, is meant to protect civilians and medical personnel, yet its violation is a recurring feature of reporting from conflict zones.',
      'The damage continues after the shooting stops. Unexploded ordnance, destroyed infrastructure and long-lasting trauma shape communities for a generation. Aid groups and mental health workers describe recovery as measured in years, not weeks.',
      'War reporters play a difficult role: documenting what happens, verifying what is claimed, and resisting the pull of propaganda from every side. Their work is dangerous, and it is one of the main ways the rest of the world learns what is being done in its name.',
      'This is a general feature written as sample content. It does not describe any single conflict.',
    ],
  },
  {
    id: 'how-gambling-hooks-the-brain',
    title: 'How Gambling Hooks the Brain',
    category: 'Health',
    rating: '18+',
    readMinutes: 6,
    summary:
      'Near-misses, variable rewards and the psychology that makes gambling hard to walk away from. Adult themes.',
    accent: '#0F766E',
    body: [
      'Gambling is designed around some of the most powerful learning signals the brain has. The key is not winning but the possibility of winning: the brain\'s reward system responds strongly to uncertain rewards, often more than to guaranteed ones.',
      'Slot machines and many online games use "variable rewards", where wins arrive at unpredictable intervals. Unpredictability keeps people playing because the next spin could always be the one.',
      'Near-misses make it worse. Two matching symbols and a third just out of line feels like almost winning, and research suggests the brain treats it as a reason to try again rather than a loss.',
      'For some people this slides from entertainment into addiction: chasing losses, hiding how much is being spent, and gambling with money meant for essentials. It is recognised as a health condition, not a failure of willpower.',
      'If gambling is causing you or someone you know harm, talk to a doctor or contact a local support service. Setting deposit limits, taking breaks and using self-exclusion tools can also help.',
    ],
  },
];

export function getArticleById(id: string | undefined): Article | undefined {
  return CATALOG.find((article) => article.id === id);
}

// Maps an article's rating to what the verifier must be shown. `null` means
// no age check at all.
export function requirementFor(article: Article): AgeRequirement | null {
  switch (article.rating) {
    case '12+':
      return '12plus';
    case '18+':
      return '18plus';
    default:
      return null;
  }
}

export function isRestricted(article: Article): boolean {
  return requirementFor(article) !== null;
}
