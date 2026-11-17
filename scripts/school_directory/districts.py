"""
District headquarters of North India, used as the search centres for the
school directory scrape. The shop shows these as the "City" a parent picks
after the state.

A tuple is (city name shown in the shop, place name to geocode).
"""

STATES: dict[str, list[tuple[str, str]]] = {
    "Delhi": [("Delhi", "New Delhi")],
    "Chandigarh": [("Chandigarh", "Chandigarh")],
    "Haryana": [
        ("Ambala", "Ambala"), ("Bhiwani", "Bhiwani"), ("Charkhi Dadri", "Charkhi Dadri"),
        ("Faridabad", "Faridabad"), ("Fatehabad", "Fatehabad"), ("Gurugram", "Gurugram"),
        ("Hisar", "Hisar"), ("Jhajjar", "Jhajjar"), ("Jind", "Jind"), ("Kaithal", "Kaithal"),
        ("Karnal", "Karnal"), ("Kurukshetra", "Kurukshetra"), ("Narnaul", "Narnaul"),
        ("Nuh", "Nuh"), ("Palwal", "Palwal"), ("Panchkula", "Panchkula"), ("Panipat", "Panipat"),
        ("Rewari", "Rewari"), ("Rohtak", "Rohtak"), ("Sirsa", "Sirsa"), ("Sonipat", "Sonipat"),
        ("Yamunanagar", "Yamunanagar"),
    ],
    "Punjab": [
        ("Amritsar", "Amritsar"), ("Barnala", "Barnala"), ("Bathinda", "Bathinda"),
        ("Faridkot", "Faridkot"), ("Fatehgarh Sahib", "Fatehgarh Sahib"), ("Fazilka", "Fazilka"),
        ("Ferozepur", "Ferozepur"), ("Gurdaspur", "Gurdaspur"), ("Hoshiarpur", "Hoshiarpur"),
        ("Jalandhar", "Jalandhar"), ("Kapurthala", "Kapurthala"), ("Ludhiana", "Ludhiana"),
        ("Malerkotla", "Malerkotla"), ("Mansa", "Mansa"), ("Moga", "Moga"),
        ("Sri Muktsar Sahib", "Sri Muktsar Sahib"), ("Pathankot", "Pathankot"),
        ("Patiala", "Patiala"), ("Rupnagar", "Rupnagar"), ("Mohali", "Sahibzada Ajit Singh Nagar"),
        ("Sangrur", "Sangrur"), ("Nawanshahr", "Nawanshahr"), ("Tarn Taran", "Tarn Taran Sahib"),
    ],
    "Himachal Pradesh": [
        ("Bilaspur", "Bilaspur"), ("Chamba", "Chamba"), ("Hamirpur", "Hamirpur"),
        ("Dharamshala", "Dharamshala"), ("Reckong Peo", "Reckong Peo"), ("Kullu", "Kullu"),
        ("Keylong", "Keylong"), ("Mandi", "Mandi"), ("Shimla", "Shimla"), ("Nahan", "Nahan"),
        ("Solan", "Solan"), ("Una", "Una"),
    ],
    "Uttarakhand": [
        ("Almora", "Almora"), ("Bageshwar", "Bageshwar"), ("Gopeshwar", "Gopeshwar"),
        ("Champawat", "Champawat"), ("Dehradun", "Dehradun"), ("Haridwar", "Haridwar"),
        ("Nainital", "Nainital"), ("Haldwani", "Haldwani"), ("Pauri", "Pauri"),
        ("Pithoragarh", "Pithoragarh"), ("Rudraprayag", "Rudraprayag"), ("New Tehri", "New Tehri"),
        ("Rudrapur", "Rudrapur"), ("Uttarkashi", "Uttarkashi"),
    ],
    "Jammu and Kashmir": [
        ("Anantnag", "Anantnag"), ("Bandipora", "Bandipora"), ("Baramulla", "Baramulla"),
        ("Budgam", "Budgam"), ("Doda", "Doda"), ("Ganderbal", "Ganderbal"), ("Jammu", "Jammu"),
        ("Kathua", "Kathua"), ("Kishtwar", "Kishtwar"), ("Kulgam", "Kulgam"),
        ("Kupwara", "Kupwara"), ("Poonch", "Poonch"), ("Pulwama", "Pulwama"),
        ("Rajouri", "Rajouri"), ("Ramban", "Ramban"), ("Reasi", "Reasi"), ("Samba", "Samba"),
        ("Shopian", "Shopian"), ("Srinagar", "Srinagar"), ("Udhampur", "Udhampur"),
    ],
    "Ladakh": [("Leh", "Leh"), ("Kargil", "Kargil")],
    "Rajasthan": [
        ("Ajmer", "Ajmer"), ("Alwar", "Alwar"), ("Banswara", "Banswara"), ("Baran", "Baran"),
        ("Barmer", "Barmer"), ("Bharatpur", "Bharatpur"), ("Bhilwara", "Bhilwara"),
        ("Bikaner", "Bikaner"), ("Bundi", "Bundi"), ("Chittorgarh", "Chittorgarh"),
        ("Churu", "Churu"), ("Dausa", "Dausa"), ("Dholpur", "Dholpur"), ("Dungarpur", "Dungarpur"),
        ("Hanumangarh", "Hanumangarh"), ("Jaipur", "Jaipur"), ("Jaisalmer", "Jaisalmer"),
        ("Jalore", "Jalore"), ("Jhalawar", "Jhalawar"), ("Jhunjhunu", "Jhunjhunu"),
        ("Jodhpur", "Jodhpur"), ("Karauli", "Karauli"), ("Kota", "Kota"), ("Nagaur", "Nagaur"),
        ("Pali", "Pali"), ("Pratapgarh", "Pratapgarh"), ("Rajsamand", "Rajsamand"),
        ("Sawai Madhopur", "Sawai Madhopur"), ("Sikar", "Sikar"), ("Sirohi", "Sirohi"),
        ("Sri Ganganagar", "Sri Ganganagar"), ("Tonk", "Tonk"), ("Udaipur", "Udaipur"),
        ("Balotra", "Balotra"), ("Beawar", "Beawar"), ("Deeg", "Deeg"), ("Didwana", "Didwana"),
        ("Kotputli", "Kotputli"), ("Khairthal", "Khairthal"), ("Phalodi", "Phalodi"),
        ("Salumbar", "Salumbar"),
    ],
    "Uttar Pradesh": [
        ("Agra", "Agra"), ("Aligarh", "Aligarh"), ("Akbarpur", "Akbarpur, Ambedkar Nagar"),
        ("Amethi", "Gauriganj"), ("Amroha", "Amroha"), ("Auraiya", "Auraiya"),
        ("Ayodhya", "Ayodhya"), ("Azamgarh", "Azamgarh"), ("Baghpat", "Baghpat"),
        ("Bahraich", "Bahraich"), ("Ballia", "Ballia"), ("Balrampur", "Balrampur"),
        ("Banda", "Banda"), ("Barabanki", "Barabanki"), ("Bareilly", "Bareilly"),
        ("Basti", "Basti"), ("Bhadohi", "Gyanpur"), ("Bijnor", "Bijnor"), ("Budaun", "Budaun"),
        ("Bulandshahr", "Bulandshahr"), ("Chandauli", "Chandauli"), ("Chitrakoot", "Karwi"),
        ("Deoria", "Deoria"), ("Etah", "Etah"), ("Etawah", "Etawah"),
        ("Farrukhabad", "Fatehgarh"), ("Fatehpur", "Fatehpur"), ("Firozabad", "Firozabad"),
        ("Noida", "Noida"), ("Ghaziabad", "Ghaziabad"), ("Ghazipur", "Ghazipur"),
        ("Gonda", "Gonda"), ("Gorakhpur", "Gorakhpur"), ("Hamirpur", "Hamirpur"),
        ("Hapur", "Hapur"), ("Hardoi", "Hardoi"), ("Hathras", "Hathras"), ("Orai", "Orai"),
        ("Jaunpur", "Jaunpur"), ("Jhansi", "Jhansi"), ("Kannauj", "Kannauj"),
        ("Kanpur", "Kanpur"), ("Kanpur Dehat", "Kanpur Dehat"), ("Kasganj", "Kasganj"),
        ("Kaushambi", "Manjhanpur"), ("Padrauna", "Padrauna"), ("Lakhimpur", "Lakhimpur"),
        ("Lalitpur", "Lalitpur"), ("Lucknow", "Lucknow"), ("Maharajganj", "Maharajganj"),
        ("Mahoba", "Mahoba"), ("Mainpuri", "Mainpuri"), ("Mathura", "Mathura"), ("Mau", "Mau"),
        ("Meerut", "Meerut"), ("Mirzapur", "Mirzapur"), ("Moradabad", "Moradabad"),
        ("Muzaffarnagar", "Muzaffarnagar"), ("Pilibhit", "Pilibhit"),
        ("Pratapgarh", "Bela Pratapgarh"), ("Prayagraj", "Prayagraj"), ("Raebareli", "Raebareli"),
        ("Rampur", "Rampur"), ("Saharanpur", "Saharanpur"), ("Sambhal", "Sambhal"),
        ("Khalilabad", "Khalilabad"), ("Shahjahanpur", "Shahjahanpur"), ("Shamli", "Shamli"),
        ("Bhinga", "Bhinga"), ("Siddharthnagar", "Naugarh, Siddharthnagar"),
        ("Sitapur", "Sitapur"), ("Robertsganj", "Robertsganj"), ("Sultanpur", "Sultanpur"),
        ("Unnao", "Unnao"), ("Varanasi", "Varanasi"),
    ],
}

# Big cities get a grid of extra search points (offset in km from the centre),
# because each Google Maps query returns at most about 20 places.
GRID_KM = {
    "Delhi": (5, 6.0),  # 5x5 points, 6 km apart
    "Jaipur": (3, 6.0), "Lucknow": (3, 6.0), "Kanpur": (3, 6.0), "Agra": (3, 5.0),
    "Varanasi": (3, 5.0), "Prayagraj": (3, 5.0), "Meerut": (3, 5.0), "Ghaziabad": (3, 5.0),
    "Noida": (3, 5.0), "Gurugram": (3, 5.0), "Faridabad": (3, 5.0), "Ludhiana": (3, 5.0),
    "Amritsar": (3, 5.0), "Jalandhar": (3, 5.0), "Chandigarh": (3, 5.0), "Dehradun": (3, 5.0),
    "Jodhpur": (3, 5.0), "Kota": (3, 5.0), "Udaipur": (3, 5.0), "Bareilly": (3, 5.0),
    "Moradabad": (3, 5.0), "Aligarh": (3, 5.0), "Gorakhpur": (3, 5.0), "Jammu": (3, 5.0),
    "Srinagar": (3, 5.0), "Patiala": (3, 5.0), "Bikaner": (3, 5.0), "Ajmer": (3, 5.0),
    "Mohali": (3, 4.0), "Panchkula": (3, 4.0), "Haldwani": (3, 4.0), "Jhansi": (3, 5.0),
}
