import Foundation

struct DashboardHabit: Identifiable, Codable {
    let id: Int
    let name: String
    let completedDates: [String] // "yyyy-MM-dd", UTC — matches the server's date format

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    private static var utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    var isDoneToday: Bool {
        completedDates.contains(Self.dayFormatter.string(from: Date()))
    }

    var currentStreak: Int {
        let set = Set(completedDates)
        var day = Self.utcCalendar.startOfDay(for: Date())
        var streak = 0
        while set.contains(Self.dayFormatter.string(from: day)) {
            streak += 1
            guard let previous = Self.utcCalendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }
        return streak
    }
}

struct DashboardParticipant: Identifiable, Codable {
    let id: Int
    let telegramId: Int
    let displayName: String
    let habits: [DashboardHabit]
}

struct DashboardResponse: Codable {
    let participants: [DashboardParticipant]
}
