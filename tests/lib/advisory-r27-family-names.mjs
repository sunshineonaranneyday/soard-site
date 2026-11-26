/**
 * Round 27 (finding 1, the lead's rule: a family name is never taken for a place or an organisation): common family names
 * of the peoples who write them last, written out by the round 27 names fixer apart from the code's lists (_given-names.js
 * SURNAMES and FAMILY_LAST), by people, the ones that are words in some language among them (Camara, Kinder, Capilla,
 * Condado, Reino, Junta, Banco, Carne, Carnes). tests/advisory-round27-names.test.mjs checks that no word the place lists
 * count on its own is one of these, nor of the code's. Family names only, never a person's whole name
 */
export const R27_FAMILY_NAMES = `
  camara kamara diallo bah barry sow balde baldé sylla soumah bangoura conde condé keita kante kanté toure touré traore
  traoré coulibaly kone koné cisse cissé diakite diakité sangare sangaré doumbia fofana konate konaté sissoko diarra dembele
  dembélé ndiaye diop fall gueye faye sarr mbaye seck niang thiam diouf ba sy ly kane sall dieng diagne mendy gomis sagna
  jallow ceesay jammeh darboe touray sanneh bojang sowe njie sesay kargbo conteh koroma turay mansaray kallon jalloh
  okafor okonkwo nwankwo eze okeke obi chukwu nwosu okoye adeyemi adebayo ogunleye afolabi oladipo bello abubakar musa
  mensah owusu boateng asante osei appiah agyeman addo ansah amoah acheampong yeboah ofori opoku frimpong antwi badu
  tesfaye haile bekele girma alemu tadesse kebede abebe mekonnen warsame farah abdi jama hersi mwangi otieno kamau
  hernandez garcia martinez lopez gonzalez perez rodriguez sanchez ramirez cruz flores gomez diaz reyes morales jimenez
  ruiz alvarez castillo romero torres vargas ramos mendoza aguilar ortiz moreno medina castro herrera guzman chavez
  rojas delgado vazquez salazar soto contreras luna rios rivera estrada fuentes campos montes vega prado mercado
  palacios iglesias cortes navarro santiago serrano molina cabrera nieto pena paz rey sol camacho cano lozano marin
  capilla condado reino junta banco carne carnes torre villa plaza puerto arroyo valle sierra robles salinas
  silva santos oliveira souza sousa pereira lima ferreira costa rodrigues almeida nascimento carvalho araujo ribeiro
  gomes martins barbosa rocha dias alves moreira cardoso teixeira correia mendes pinto cunha monteiro vieira machado
  câmara cámara camara
  muller mueller schmidt schneider fischer weber meyer wagner becker schulz hoffmann koch richter klein wolf schroder
  neumann schwarz zimmermann braun kruger kroger hartmann lange werner krause lehmann kaiser konig koenig bauer kinder
  kirch kirchner huber fuchs vogel keller roth beck lorenz baumann winter jager sommer brandt haas schreiber graf engel
  rossi russo ferrari esposito bianchi romano colombo ricci marino greco bruno gallo conti costa giordano mancini rizzo
  lombardi moretti barbieri fontana santoro caruso ferrara leone longo gentile vitale serra chiesa ponte porta
  martin bernard dubois thomas robert richard petit durand leroy moreau simon laurent lefebvre michel garnier faure
  rousseau blanc roux fournier girard bonnet dupont lambert fontaine chevalier mercier boucher gagnon tremblay
  dejong jansen devries bakker visser smit meijer mulder bos vos dekker brouwer dijkstra kok jacobs vermeulen
  hansen johansen olsen larsen andersen pedersen nielsen jensen johansson andersson karlsson nilsson eriksson larsson
  nowak kowalski wisniewski wojcik kowalczyk kaminski lewandowski zielinski szymanski wozniak mazur krol
  novak svoboda novotny dvorak cerny horak kral popescu ionescu popa radu horvat kovacevic petrovic jovanovic nikolic
  papadopoulos georgiou pappas ivanov smirnov kuznetsov popov petrov sokolov volkov shevchenko kovalenko bondarenko melnyk
  yilmaz kaya demir sahin celik yildiz ozturk aydin ozdemir arslan dogan kilic haddad khoury nasser saleh mansour khalil
  hosseini mohammadi ahmadi rezaei karimi patel shah singh kumar sharma gupta reddy iyer nair pillai das khan ahmed ali
  hussain rahman chowdhury islam santos reyes bautista ocampo aquino villanueva soriano dizon manalo domingo
  cohen levi levy katz friedman goldberg shapiro rosen stern mizrahi petrosyan sargsyan grigoryan
  jeanbaptiste pierre joseph louis charles etienne toussaint celestin desir`;
