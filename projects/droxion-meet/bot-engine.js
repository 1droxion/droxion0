"use strict";
/* Droxion Meet offline conversational demo engine.
 * All profiles are fictional, bot-authored replies run in the browser.
 * Not AI-generated; no network traffic, real accounts, location, payments or live dates.
 * Do not misrepresent these bots as real members. */
(function() {
 const topics=[
 {key:"gaming",regex:/\b(gam(e|es|ing|er)|play|xbox|ps5|console|stream|minecraft|fortnite|gta)\b/i,ask:"What's a game you keep returning to?"},
 {key:"coffee",regex:/\b(coffee|cafe|café|latte|tea|espresso)\b/i,ask:"Are you more into a cozy café or a quick coffee run?"},
 {key:"music",regex:/\b(music|song|concert|artist|band|playlist|sing|dance)\b/i,ask:"What's the last song you had on repeat?"},
 {key:"movies",regex:/\b(movie|movies|film|cinema|netflix|show|series)\b/i,ask:"Do you prefer comedies, thrillers, or something else?"},
 {key:"food",regex:/\b(food|restaurant|taco|pizza|dinner|lunch|cook|recipe|eat|sushi|pasta)\b/i,ask:"What's your favorite food to order when you want something good?"},
 {key:"travel",regex:/\b(travel|trip|vacation|beach|mountain|roadtrip|flight)\b/i,ask:"Would you pick a city weekend or somewhere out in nature?"},
 {key:"art",regex:/\b(art|gallery|paint|draw|photo|photography|museum|design)\b/i,ask:"Do you prefer creating things or seeing other people's work?"},
 {key:"fitness",regex:/\b(run|running|walk|gym|workout|fitness|hike|hiking|yoga)\b/i,ask:"Do you prefer getting outside or exercising indoors?"},
 {key:"friends",regex:/\b(friend|friends|friendship|community|hangout|hanging out)\b/i,ask:"What kind of shared activity makes it easy to get to know someone?"}
 ];
 function topicOf(text) { const found=topics.find(t=>t.regex.test(text)); return found?found.key:null; }
 const pick=(arr,count)=>arr[Math.max(0,count)%arr.length];
 function respond(profile,input,history) {
   const text=String(input||"").slice(0,300).trim();
   const lower=text.toLowerCase();
   const before=Array.isArray(history)?history.filter(m=>m&&m.from==="self"):[]; // pass prior history before latest message
   const turns=before.length;
   const intro=turns===0 ? "Hi! I'm "+profile.name+", a fictional demo bot. " : "";
   if(!text)return intro+"What would you like to chat about?";
   // Do not solicit real contact data, dates, payment, home address, or move offline.
   if(/\b(phone number|contact|whatsapp|instagram|snap(chat)?|telegram|email|your number|address|where do you live|exact location)\b/i.test(text))
     return "I'm a fictional demo bot, so I don't have real contact details, an address, or social accounts. We can keep practicing the conversation here.";
   if(/\b(tonight|meet up|meet in person|can we meet|let.?s meet|go on a date|come over|my house|hotel)\b/i.test(text))
     return "That sounds like a real-world plan, but I'm only a fictional demo bot and can't meet. For your preview, you can create a sample public-place or online plan in the Plans tab.";
   if(/\b(pay|payment|money|cash app|venmo|send money|gift card|crypto)\b/i.test(text))
     return "I'm a demo bot, not a real match or payment recipient. Never send money to someone you've only met on a dating app.";
   if(/\b(sex|nudes?|explicit|porn|hookup tonight)\b/i.test(text))
     return "This demo chat stays non-explicit. If you're exploring casual dating, clear expectations, consent, and respect matter.";
   if(/\b(kill myself|suicide|hurt myself|self harm)\b/i.test(text))
     return "I'm only a demo chatbot and can't provide crisis support. If you're in immediate danger, call emergency services. In the US, you can call or text 988 for support.";
   if(/\b(are you real|human|fake|bot|ai)\b/i.test(text))
     return "I'm a fictional chat demo, not a real person and not an AI model. My replies are generated from local conversation rules so you can test this interface.";
   if(/\b(hi|hello|hey|what.?s up|how are you)\b/i.test(text))
     return intro+pick(["How's your day going? "+profile.prompt,"Nice to chat! "+profile.prompt,"Hope your day is going well. "+profile.prompt],turns);
   if(/\b(what do you do|your job|work|career|occupation)\b/i.test(text))
     return intro+"In this fictional profile, my job is "+profile.work.toLowerCase()+". Outside work I enjoy "+profile.interests.slice(0,2).join(" and ").toLowerCase()+". What are you into?";
   if(/\b(what do you like|your interest|your hobbies|about you|tell me about yourself)\b/i.test(text))
     return intro+"My demo profile is into "+profile.interests.join(", ")+". "+profile.bio+" What's one of your favorites?";
   if(/\b(thank(s| you)|cool|nice|awesome|great|haha|lol)\b/i.test(text))
     return intro+pick(["I like your energy! "+profile.prompt,"That's fun. "+profile.prompt,"Glad that came across! "+profile.prompt],turns);
   if(/\b(yes|yeah|yep|sure|sounds good|of course|no|nah|maybe)\b/i.test(text) && text.split(/\s+/).length<=4)
     return intro+pick(["Fair enough. "+profile.prompt,"Makes sense. What do you like doing on weekends?","No pressure. What's something you've been enjoying lately?"],turns);
   let topic=topicOf(text);
   if(!topic) {
     const prior=before.slice(-3).reverse().find(m=>topicOf(m.text||""));
     topic=prior?topicOf(prior.text):null;
   }
   const specialized={
     gaming:["I've been curious about new games lately. ","Co-op games are a fun way to connect. ","Gaming makes for an easy shared activity. "],
     coffee:["A good café is such an easy conversation starter. ","I like the idea of a relaxed public coffee meetup. ","A cozy café would be a fun idea in a real app. "],
     music:["A great playlist can make any day better. ","Live shows have such good energy. ","Discovering new artists is always fun. "],
     movies:["I like picking a movie based on the mood. ","Movie nights are a great conversation topic. ","I can talk about favorite films for ages. "],
     food:["Food is an easy way to discover shared interests. ","I love hearing about people's go-to comfort foods. ","Trying a new restaurant sounds fun in theory. "],
     travel:["Exploring new places is something I enjoy in this fictional profile. ","Weekend escapes can be really refreshing. ","Travel stories always make interesting conversations. "],
     art:["Creative things can be a great conversation starter. ","I like the idea of discovering an art gallery together. ","There's always something new to see in a museum. "],
     fitness:["Getting moving can help clear your head. ","I love the idea of a daytime walk in a public park. ","Outdoorsy plans are a fun way to connect. "],
     friends:["Shared interests make new friendships feel easier. ","It can be nice to meet people around an activity. ","Community is often about just showing up. "]
   };
   if(topic) return intro+pick(specialized[topic],turns)+topics.find(t=>t.key===topic).ask;
   // Never manufacture personal memories or pretend to know the user's identity or physical location.
   return intro+pick([
     "That's interesting. "+profile.prompt,
     "Tell me a bit more about what you mean. My demo interests are "+profile.interests.slice(0,2).join(" and ").toLowerCase()+".",
     "I'm listening. For this demo, one of my favorite subjects is "+profile.interests[0].toLowerCase()+". What about you?",
     "I like learning what makes someone curious. "+profile.prompt
   ],turns);
 }
 window.DROXION_MEET_BOT={respond};
})();